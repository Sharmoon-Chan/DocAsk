package com.kama.jchatmind.models;

import com.fasterxml.jackson.core.JsonProcessingException;
import org.springframework.core.codec.DecodingException;
import org.springframework.http.converter.HttpMessageConversionException;
import org.springframework.web.client.RestClientResponseException;
import org.springframework.web.client.UnknownContentTypeException;
import org.springframework.web.reactive.function.client.WebClientResponseException;

import javax.net.ssl.SSLException;
import java.io.EOFException;
import java.io.InterruptedIOException;
import java.net.ConnectException;
import java.net.NoRouteToHostException;
import java.net.SocketException;
import java.net.SocketTimeoutException;
import java.net.UnknownHostException;
import java.net.http.HttpConnectTimeoutException;
import java.net.http.HttpTimeoutException;
import java.nio.channels.ClosedByInterruptException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.IdentityHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.CancellationException;
import java.util.concurrent.TimeoutException;

/**
 * A safe classification of one failed model request, not of an entire Agent run.
 * No response body, request URL, exception message or original cause is retained.
 */
public record ModelCallFailure(Kind kind, String exceptionType, ProviderFailure providerFailure) {

    public enum Kind {
        RATE_LIMITED, UPSTREAM_UNAVAILABLE, HTTP_TIMEOUT,
        CONNECT_TIMEOUT, READ_TIMEOUT, CONNECTION_FAILURE,
        INVALID_RESPONSE, REQUEST_REJECTED, CONFIGURATION, DNS_FAILURE, TLS_FAILURE,
        CANCELLED, INTERRUPTED, UNKNOWN
    }

    private static final Set<String> PERMANENT_PROVIDER_CODES = Set.of(
            "insufficient_quota", "billing_hard_limit_reached", "invalid_api_key",
            "authentication_error", "permission_denied", "model_not_found");

    public ModelCallFailure {
        kind = kind == null ? Kind.UNKNOWN : kind;
        exceptionType = safe(exceptionType, "[A-Za-z0-9_$]{1,80}");
    }

    public static ModelCallFailure classify(Throwable failure) {
        List<Throwable> causes = causeChain(failure);
        ModelCallFailure carried = causes.stream()
                .filter(ModelCallException.class::isInstance)
                .map(ModelCallException.class::cast)
                .map(ModelCallException::failure).findFirst().orElse(null);
        String type = carried != null ? carried.exceptionType()
                : causes.isEmpty() ? "unknown" : causes.get(causes.size() - 1).getClass().getSimpleName();

        // An interrupt/cancellation wins even if a provider error happens to be in the same chain.
        // SocketTimeoutException inherits InterruptedIOException but is not a thread interrupt.
        if (Thread.currentThread().isInterrupted() || causes.stream().anyMatch(cause ->
                cause instanceof InterruptedException || cause instanceof ClosedByInterruptException
                        || cause instanceof InterruptedIOException && !(cause instanceof SocketTimeoutException))) {
            return new ModelCallFailure(Kind.INTERRUPTED, type, null);
        }
        if (causes.stream().anyMatch(CancellationException.class::isInstance)) {
            return new ModelCallFailure(Kind.CANCELLED, type, null);
        }
        if (carried != null) {
            return carried;
        }
        for (Throwable cause : causes) {
            ProviderFailure details = providerDetails(cause);
            if (details != null) {
                String code = details.providerCode() == null ? ""
                        : details.providerCode().toLowerCase(Locale.ROOT);
                Kind kind;
                if (PERMANENT_PROVIDER_CODES.contains(code)) {
                    kind = Kind.REQUEST_REJECTED;
                } else if (details.status() == 429
                        || details.status() == 503 && "rate_limit_exceeded".equals(code)) {
                    kind = Kind.RATE_LIMITED;
                } else if (details.status() == 408) {
                    kind = Kind.HTTP_TIMEOUT;
                } else if (Set.of(500, 502, 503, 504).contains(details.status())) {
                    kind = Kind.UPSTREAM_UNAVAILABLE;
                } else if (details.status() >= 400 && details.status() < 500) {
                    kind = Kind.REQUEST_REJECTED;
                } else {
                    kind = Kind.UNKNOWN;
                }
                return new ModelCallFailure(kind, type, details);
            }
        }

        // Prefer an explicit timeout even when a TLS/client wrapper surrounds the transport cause.
        for (Throwable cause : causes) {
            if (cause instanceof HttpConnectTimeoutException
                    || cause.getClass().getName().equals("io.netty.channel.ConnectTimeoutException")
                    || cause instanceof SocketTimeoutException && messageContains(cause, "connect timed out")) {
                return new ModelCallFailure(Kind.CONNECT_TIMEOUT, type, null);
            }
            if (cause instanceof SocketTimeoutException || cause instanceof HttpTimeoutException
                    || cause instanceof TimeoutException
                    || cause.getClass().getName().equals("io.netty.handler.timeout.ReadTimeoutException")) {
                return new ModelCallFailure(Kind.READ_TIMEOUT, type, null);
            }
        }
        // Certificate/TLS and DNS failures without an explicit timeout are not assumed transient.
        if (causes.stream().anyMatch(SSLException.class::isInstance)) {
            return new ModelCallFailure(Kind.TLS_FAILURE, type, null);
        }
        if (causes.stream().anyMatch(UnknownHostException.class::isInstance)) {
            return new ModelCallFailure(Kind.DNS_FAILURE, type, null);
        }
        if (causes.stream().anyMatch(cause -> cause instanceof ConnectException
                || cause instanceof NoRouteToHostException || cause instanceof EOFException
                || cause instanceof SocketException && messageContains(cause,
                "connection reset", "connection abort", "broken pipe", "socket closed", "unexpected end of file"))) {
            return new ModelCallFailure(Kind.CONNECTION_FAILURE, type, null);
        }
        if (causes.stream().anyMatch(cause -> cause instanceof JsonProcessingException
                || cause instanceof HttpMessageConversionException || cause instanceof DecodingException
                || cause instanceof UnknownContentTypeException)) {
            return new ModelCallFailure(Kind.INVALID_RESPONSE, type, null);
        }
        if (causes.stream().anyMatch(cause -> cause instanceof ModelException model
                && model.getStatus() >= 400 && model.getStatus() < 500)) {
            return new ModelCallFailure(Kind.CONFIGURATION, type, null);
        }
        return new ModelCallFailure(Kind.UNKNOWN, type, null);
    }

    /** Only failures explicitly identified as transient can retry. */
    public boolean retryable() {
        return switch (kind) {
            case RATE_LIMITED, UPSTREAM_UNAVAILABLE, HTTP_TIMEOUT,
                    CONNECT_TIMEOUT, READ_TIMEOUT, CONNECTION_FAILURE -> true;
            default -> false;
        };
    }

    /** Allowlisted, bounded diagnostics for model events. Never includes an exception message. */
    public String toDetail() {
        String detail = "kind=" + kind + ";type=" + exceptionType;
        if (providerFailure != null) {
            detail += ";http=" + (providerFailure.status() >= 100 && providerFailure.status() <= 599
                    ? Integer.toString(providerFailure.status()) : "unknown")
                    + ";retry-after=" + safe(providerFailure.retryAfter(), "[0-9]{1,6}")
                    + ";code=" + safe(providerFailure.providerCode(), "[A-Za-z0-9_.:-]{1,64}")
                    + ";req=" + safe(providerFailure.requestId(), "[A-Za-z0-9_.:-]{1,32}");
        }
        if (providerFailure == null && Set.of("TransportCapacityUnavailable", "ModelTransportClosed").contains(exceptionType)) {
            detail += ";dispatch=not-started";
        }
        return detail.length() <= 200 ? detail : detail.substring(0, 200);
    }

    private static String safe(String value, String pattern) {
        if (value == null || !value.matches(pattern) || value.toLowerCase(Locale.ROOT).startsWith("sk-")) {
            return "unknown";
        }
        return value;
    }

    private static ProviderFailure providerDetails(Throwable cause) {
        if (cause instanceof ProviderUnavailableException provider) return provider.failure();
        if (cause instanceof RestClientResponseException response) {
            return ProviderFailure.of(response.getStatusCode().value(), response.getResponseHeaders(),
                    brief(response.getResponseBodyAsString()));
        }
        if (cause instanceof WebClientResponseException response) {
            return ProviderFailure.of(response.getStatusCode().value(), response.getHeaders(),
                    brief(response.getResponseBodyAsString()));
        }
        return null;
    }

    private static String brief(String body) {
        return body == null ? "" : body.substring(0, Math.min(2048, body.length()));
    }

    private static boolean messageContains(Throwable failure, String... fragments) {
        String message = failure.getMessage();
        if (message == null) return false;
        String lower = message.toLowerCase(Locale.ROOT);
        for (String fragment : fragments) {
            if (lower.contains(fragment)) return true;
        }
        return false;
    }

    private static List<Throwable> causeChain(Throwable failure) {
        List<Throwable> causes = new ArrayList<>();
        Set<Throwable> visited = Collections.newSetFromMap(new IdentityHashMap<>());
        for (Throwable current = failure; current != null && causes.size() < 32 && visited.add(current);
             current = current.getCause()) {
            causes.add(current);
        }
        return causes;
    }
}

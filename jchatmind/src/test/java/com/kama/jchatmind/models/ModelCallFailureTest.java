package com.kama.jchatmind.models;

import com.fasterxml.jackson.core.JsonParseException;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.client.RestClientException;

import javax.net.ssl.SSLHandshakeException;
import javax.net.ssl.SSLException;
import java.io.EOFException;
import java.net.ConnectException;
import java.net.SocketException;
import java.net.SocketTimeoutException;
import java.net.UnknownHostException;
import java.time.Duration;
import java.util.concurrent.CancellationException;

import static org.junit.jupiter.api.Assertions.*;

class ModelCallFailureTest {

    @ParameterizedTest
    @ValueSource(ints = {408, 429, 500, 502, 503, 504})
    void retriesOnlyTheAllowlistedTransientHttpStatuses(int status) {
        ModelCallFailure result = ModelCallFailure.classify(new IllegalStateException("outer",
                new ProviderUnavailableException(new ProviderFailure(status, "2", "unknown", "req-test"))));
        assertTrue(result.retryable());
        assertEquals(status, result.providerFailure().status());
        assertTrue(result.toDetail().contains("http=" + status));
    }

    @ParameterizedTest
    @ValueSource(ints = {400, 401, 403, 404, 405, 413, 422, 501, 505})
    void doesNotRetryPermanentOrUnclassifiedHttpStatuses(int status) {
        assertFalse(ModelCallFailure.classify(new ProviderUnavailableException(
                new ProviderFailure(status, "unknown", "unknown", "unknown"))).retryable());
    }

    @Test
    void quotaOrCredentialRejectionIsNotMistakenForTransientThrottling() {
        ModelCallFailure result = ModelCallFailure.classify(new ProviderUnavailableException(
                new ProviderFailure(429, "unknown", "insufficient_quota", "unknown")));
        assertEquals(ModelCallFailure.Kind.REQUEST_REJECTED, result.kind());
        assertFalse(result.retryable());
    }

    @Test
    void nestedReadTimeoutKeepsItsTypeWithoutKeepingTheRawCause() {
        RuntimeException raw = new ResourceAccessException("private request details",
                new SocketTimeoutException("Read timed out at https://private.example/credential"));
        ModelCallFailure failure = ModelCallFailure.classify(raw);
        assertEquals(ModelCallFailure.Kind.READ_TIMEOUT, failure.kind());
        assertEquals("SocketTimeoutException", failure.exceptionType());
        assertTrue(failure.retryable());
        ModelCallException safe = new ModelCallException(failure);
        assertNull(safe.getCause());
        assertSame(failure, ModelCallFailure.classify(safe));
        assertFalse(safe.getMessage().contains("private"));
        assertFalse(failure.toDetail().contains("private"));
        assertFalse(failure.toDetail().contains("https://"));
    }

    @Test
    void classifiesKnownConnectionFailuresAndRejectsUnknownSocketFailures() {
        assertEquals(ModelCallFailure.Kind.CONNECT_TIMEOUT, ModelCallFailure.classify(
                new SocketTimeoutException("connect timed out")).kind());
        assertTrue(ModelCallFailure.classify(new ConnectException("Connection refused")).retryable());
        assertTrue(ModelCallFailure.classify(new SocketException("Connection reset")).retryable());
        assertTrue(ModelCallFailure.classify(new EOFException("response ended")).retryable());
        assertFalse(ModelCallFailure.classify(new SocketException("Invalid argument")).retryable());
    }

    @Test
    void malformedResponseTlsDnsAndConfigurationAreNotBlindlyRetried() {
        assertEquals(ModelCallFailure.Kind.INVALID_RESPONSE, ModelCallFailure.classify(
                new RestClientException("decode", new JsonParseException(null, "private response"))).kind());
        assertFalse(ModelCallFailure.classify(new JsonParseException(null, "bad payload")).retryable());
        assertFalse(ModelCallFailure.classify(new SSLHandshakeException("certificate mismatch")).retryable());
        assertFalse(ModelCallFailure.classify(new UnknownHostException("private host")).retryable());
        assertEquals(ModelCallFailure.Kind.CONFIGURATION,
                ModelCallFailure.classify(new ModelException(400, "unsupported protocol")).kind());
        assertFalse(ModelCallFailure.classify(new IllegalStateException("arbitrary failure")).retryable());
    }

    @Test
    void anExplicitTimeoutInsideATlsWrapperRemainsARetryableTimeout() {
        ModelCallFailure failure = ModelCallFailure.classify(new SSLException("transport wrapper",
                new SocketTimeoutException("Read timed out")));
        assertEquals(ModelCallFailure.Kind.READ_TIMEOUT, failure.kind());
        assertEquals("SocketTimeoutException", failure.exceptionType());
        assertTrue(failure.retryable());
    }

    @Test
    void cancellationAndInterruptWinOverAnOtherwiseRetryableError() {
        assertEquals(ModelCallFailure.Kind.CANCELLED,
                ModelCallFailure.classify(new CancellationException("cancelled")).kind());
        assertEquals(ModelCallFailure.Kind.INTERRUPTED,
                ModelCallFailure.classify(new RuntimeException(new InterruptedException())).kind());
        try {
            Thread.currentThread().interrupt();
            ModelCallFailure result = ModelCallFailure.classify(new ProviderUnavailableException(
                    new ProviderFailure(503, "unknown", "unknown", "unknown")));
            assertEquals(ModelCallFailure.Kind.INTERRUPTED, result.kind());
            assertFalse(result.retryable());
        } finally {
            Thread.interrupted();
        }
    }

    @Test
    void detailsRejectUnsafeFieldValuesAndStayBounded() {
        ModelCallFailure result = new ModelCallFailure(ModelCallFailure.Kind.RATE_LIMITED,
                "Exception https://private.example", new ProviderFailure(429,
                "https://private.example", "sk-fixture-sensitive", "Bearer fixture-sensitive"));
        String detail = result.toDetail();
        assertTrue(detail.contains("http=429"));
        assertFalse(detail.contains("private"));
        assertFalse(detail.contains("fixture"));
        assertTrue(detail.length() <= 200);
    }

    @Test
    void cyclicCauseChainsDoNotHangClassification() {
        RuntimeException first = new RuntimeException("one");
        RuntimeException second = new RuntimeException("two", first);
        first.initCause(second);
        assertTimeoutPreemptively(Duration.ofSeconds(1), () ->
                assertEquals(ModelCallFailure.Kind.UNKNOWN, ModelCallFailure.classify(first).kind()));
    }
}

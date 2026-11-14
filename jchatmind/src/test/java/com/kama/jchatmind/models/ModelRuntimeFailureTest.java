package com.kama.jchatmind.models;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.web.reactive.function.client.WebClient;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/** Real local HTTP faults: no provider account, network dependency or tool execution. */
class ModelRuntimeFailureTest {

    @ParameterizedTest
    @ValueSource(ints = {401, 429, 503})
    void aProviderFailureIsOneHttpAttemptNotAHiddenFrameworkRetryLoop(int status) throws Exception {
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        AtomicInteger calls = new AtomicInteger();
        server.createContext("/v1/chat/completions", exchange -> {
            calls.incrementAndGet();
            exchange.getRequestBody().readAllBytes();
            exchange.getResponseHeaders().set("Retry-After", "2");
            reply(exchange, status, "{\"error\":{\"code\":\"fixture_failure\",\"message\":\"private response content\"}}");
        });
        server.start();
        try (ModelRuntimeService runtime = runtime(new ModelSettings())) {
            ModelException safe = assertThrows(ModelException.class, () ->
                    runtime.chatClient(model(server)).prompt().user("test").call().content());
            ModelCallFailure diagnostics = ModelCallFailure.classify(safe);
            assertEquals(status, diagnostics.providerFailure().status());
            assertEquals(status != 401, diagnostics.retryable());
            assertEquals(1, calls.get(), "the Agent, not Spring AI, owns any subsequent attempt");
            assertFalse(safe.getMessage().contains("private"));
            assertNull(safe.getCause());
        } finally {
            server.stop(0);
        }
    }

    @Test
    void malformedJsonIsDiagnosedAndNotSilentlyRetried() throws Exception {
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        AtomicInteger calls = new AtomicInteger();
        server.createContext("/v1/chat/completions", exchange -> {
            calls.incrementAndGet();
            exchange.getRequestBody().readAllBytes();
            reply(exchange, 200, "{\"choices\":[");
        });
        server.start();
        try (ModelRuntimeService runtime = runtime(new ModelSettings())) {
            ModelCallException safe = assertThrows(ModelCallException.class, () ->
                    runtime.chatClient(model(server)).prompt().user("test").call().content());
            assertEquals(ModelCallFailure.Kind.INVALID_RESPONSE, safe.failure().kind());
            assertFalse(safe.failure().retryable());
            assertEquals(1, calls.get());
            assertNull(safe.getCause());
        } finally {
            server.stop(0);
        }
    }

    @Test
    void llmReadTimeoutIsBoundedTypedAndIndependentOfEmbeddingTimeout() throws Exception {
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        CountDownLatch release = new CountDownLatch(1);
        AtomicInteger calls = new AtomicInteger();
        server.createContext("/v1/chat/completions", exchange -> {
            calls.incrementAndGet();
            exchange.getRequestBody().readAllBytes();
            try {
                release.await(8, TimeUnit.SECONDS);
                reply(exchange, 200, "{}");
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
            } catch (IOException disconnectedAfterTimeout) {
                // The client timeout deliberately closes the connection before this fixture replies.
            } finally {
                exchange.close();
            }
        });
        server.start();
        try {
            ModelSettings settings = new ModelSettings();
            settings.setLlmReadTimeoutSeconds(1);
            assertEquals(90, settings.getRequestTimeoutSeconds(), "Embedding configuration stays unchanged");
            try (ModelRuntimeService runtime = runtime(settings)) {
                assertTimeout(Duration.ofSeconds(3), () -> {
                    ModelCallException safe = assertThrows(ModelCallException.class, () ->
                            runtime.chatClient(model(server)).prompt().user("test").call().content());
                    assertEquals(ModelCallFailure.Kind.READ_TIMEOUT, safe.failure().kind());
                    assertTrue(java.util.Set.of("SocketTimeoutException", "ModelCallDeadlineExceeded")
                            .contains(safe.failure().exceptionType()));
                    assertTrue(safe.failure().retryable());
                    assertNull(safe.getCause());
                });
            }
            assertEquals(1, calls.get());
        } finally {
            release.countDown();
            server.stop(0);
        }
    }

    @Test
    void continuousResponseBytesCannotExtendTheWholeSynchronousCallDeadline() throws Exception {
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        CountDownLatch stop = new CountDownLatch(1);
        AtomicInteger calls = new AtomicInteger();
        AtomicInteger heartbeats = new AtomicInteger();
        server.createContext("/v1/chat/completions", exchange -> {
            calls.incrementAndGet();
            exchange.getRequestBody().readAllBytes();
            exchange.getResponseHeaders().set("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, 0);
            try (var output = exchange.getResponseBody()) {
                // The socket never goes a second without data, but JSON does not finish within the budget.
                long fixtureDeadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(3);
                while (System.nanoTime() < fixtureDeadline && !stop.await(50, TimeUnit.MILLISECONDS)) {
                    output.write(' ');
                    output.flush();
                    heartbeats.incrementAndGet();
                }
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
            } catch (IOException disconnectedAfterDeadline) {
                // Closing the fixture releases any provider transport which ignored Future cancellation.
            } finally {
                exchange.close();
            }
        });
        server.start();
        ModelSettings settings = new ModelSettings();
        settings.setLlmReadTimeoutSeconds(1);
        try (ModelRuntimeService runtime = runtime(settings)) {
            var client = runtime.chatClient(model(server));
            long started = System.nanoTime();
            ModelCallException safe = assertThrows(ModelCallException.class,
                    () -> client.prompt().user("test").call().content());
            assertEquals(ModelCallFailure.Kind.READ_TIMEOUT, safe.failure().kind());
            assertEquals("ModelCallDeadlineExceeded", safe.failure().exceptionType());
            assertTrue(Duration.ofNanos(System.nanoTime() - started).compareTo(Duration.ofSeconds(2)) < 0,
                    "periodic bytes must not reset the complete provider-call deadline");
            assertTrue(heartbeats.get() >= 3, "this must exercise a progressing response, not a silent socket");
            assertEquals(1, calls.get());
            assertNull(safe.getCause());
        } finally {
            stop.countDown();
            server.stop(0);
        }
    }

    @Test
    void llmTimeoutDefaultsAndClampsDoNotChangeTheEmbeddingSetting() {
        ModelSettings settings = new ModelSettings();
        assertEquals(5, settings.getLlmConnectTimeoutSeconds());
        assertEquals(30, settings.getLlmReadTimeoutSeconds());
        assertEquals(90, settings.getRequestTimeoutSeconds());
        settings.setLlmConnectTimeoutSeconds(-1);
        settings.setLlmReadTimeoutSeconds(999);
        assertEquals(1, settings.getLlmConnectTimeoutSeconds());
        assertEquals(120, settings.getLlmReadTimeoutSeconds());
        assertEquals(90, settings.getRequestTimeoutSeconds());
    }

    private static void reply(HttpExchange exchange, int status, String body) throws IOException {
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type", "application/json");
        exchange.sendResponseHeaders(status, bytes.length);
        try (var output = exchange.getResponseBody()) {
            output.write(bytes);
        }
    }

    private static ModelRuntimeService runtime(ModelSettings settings) {
        ModelSecretCipher cipher = mock(ModelSecretCipher.class);
        when(cipher.decrypt(anyString(), any())).thenReturn("fixture-only");
        return new ModelRuntimeService(cipher, settings, WebClient.builder());
    }

    private static ModelDefinition model(HttpServer server) {
        return new ModelDefinition("fixture", "Fixture", ModelKind.LLM, "openai",
                "http://127.0.0.1:" + server.getAddress().getPort() + "/v1", "fixture-model", "fixture-cipher",
                true, false, null, Instant.now(), Instant.now());
    }
}

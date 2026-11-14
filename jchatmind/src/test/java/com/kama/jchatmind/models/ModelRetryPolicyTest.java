package com.kama.jchatmind.models;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

class ModelRetryPolicyTest {

    @Test
    void firstTwoFailuresRetryWithBackoffAndTheThirdStops() {
        ModelCallFailure failure = new ModelCallFailure(ModelCallFailure.Kind.READ_TIMEOUT,
                "SocketTimeoutException", null);
        assertEquals(new ModelRetryPolicy.Decision(true, 2_000),
                ModelRetryPolicy.afterFailure(failure, 1, bound -> 0));
        assertEquals(new ModelRetryPolicy.Decision(true, 4_500),
                ModelRetryPolicy.afterFailure(failure, 2, bound -> bound - 1));
        assertEquals(new ModelRetryPolicy.Decision(false, 0), ModelRetryPolicy.afterFailure(failure, 3));
        assertEquals(new ModelRetryPolicy.Decision(false, 0), ModelRetryPolicy.afterFailure(failure, 0));
    }

    @Test
    void retryAfterIsRespectedAndAnExcessiveCooldownDoesNotTriggerAnEarlyRetry() {
        ModelCallFailure failure = new ModelCallFailure(ModelCallFailure.Kind.RATE_LIMITED,
                "ProviderUnavailableException", new ProviderFailure(429, "12", "unknown", "unknown"));
        assertEquals(new ModelRetryPolicy.Decision(true, 12_000),
                ModelRetryPolicy.afterFailure(failure, 1, bound -> 0));
        ModelCallFailure capped = new ModelCallFailure(ModelCallFailure.Kind.RATE_LIMITED,
                "ProviderUnavailableException", new ProviderFailure(429, "30", "unknown", "unknown"));
        assertEquals(new ModelRetryPolicy.Decision(true, 30_000),
                ModelRetryPolicy.afterFailure(capped, 1, bound -> 500));
        ModelCallFailure tooLong = new ModelCallFailure(ModelCallFailure.Kind.RATE_LIMITED,
                "ProviderUnavailableException", new ProviderFailure(429, "31", "unknown", "unknown"));
        assertFalse(ModelRetryPolicy.afterFailure(tooLong, 1).retry());
    }

    @Test
    void interruptedCancelledAndPermanentErrorsHaveNoWaitOrRetry() {
        for (ModelCallFailure.Kind kind : new ModelCallFailure.Kind[] {
                ModelCallFailure.Kind.INTERRUPTED, ModelCallFailure.Kind.CANCELLED,
                ModelCallFailure.Kind.REQUEST_REJECTED, ModelCallFailure.Kind.INVALID_RESPONSE,
                ModelCallFailure.Kind.CONFIGURATION, ModelCallFailure.Kind.UNKNOWN}) {
            assertEquals(new ModelRetryPolicy.Decision(false, 0), ModelRetryPolicy.afterFailure(
                    new ModelCallFailure(kind, "Exception", null), 1));
        }
        assertFalse(ModelRetryPolicy.afterFailure(null, 1).retry());
    }

    @Test
    void generatedJitterIsBoundedWithoutSleeping() {
        ModelCallFailure failure = new ModelCallFailure(ModelCallFailure.Kind.CONNECTION_FAILURE,
                "ConnectException", null);
        for (int i = 0; i < 100; i++) {
            ModelRetryPolicy.Decision retry = ModelRetryPolicy.afterFailure(failure, 1);
            assertTrue(retry.retry());
            assertTrue(retry.delayMillis() >= 2_000 && retry.delayMillis() <= 2_500);
        }
    }
}

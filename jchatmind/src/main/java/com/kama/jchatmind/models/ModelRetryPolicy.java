package com.kama.jchatmind.models;

import java.util.concurrent.ThreadLocalRandom;
import java.util.function.LongUnaryOperator;

/**
 * Pure retry scheduling for one model request. It never sleeps or invokes a model/tool.
 * The caller must enforce its total budget and recheck cancellation/lease while waiting.
 */
public final class ModelRetryPolicy {
    public static final int MAX_ATTEMPTS = 3;
    public static final long MAX_DELAY_MILLIS = 30_000L;

    private ModelRetryPolicy() {}

    public record Decision(boolean retry, long delayMillis) {}

    public static Decision afterFailure(ModelCallFailure failure, int failedAttempt) {
        return afterFailure(failure, failedAttempt, bound -> ThreadLocalRandom.current().nextLong(bound));
    }

    static Decision afterFailure(ModelCallFailure failure, int failedAttempt, LongUnaryOperator jitter) {
        if (failure == null || !failure.retryable() || failedAttempt < 1 || failedAttempt >= MAX_ATTEMPTS) {
            return new Decision(false, 0L);
        }
        long baseMillis = 2_000L << (failedAttempt - 1);
        ProviderFailure provider = failure.providerFailure();
        if (provider != null && provider.retryAfter() != null && provider.retryAfter().matches("[0-9]{1,6}")) {
            long requestedMillis = Long.parseLong(provider.retryAfter()) * 1_000L;
            // Do not retry earlier than a provider's long cooldown merely to fit our local cap.
            if (requestedMillis > MAX_DELAY_MILLIS) return new Decision(false, 0L);
            baseMillis = Math.max(baseMillis, requestedMillis);
        }
        long jitterBound = Math.min(500L, baseMillis / 4L) + 1L;
        long jitterMillis = Math.max(0L, Math.min(jitterBound - 1L, jitter.applyAsLong(jitterBound)));
        return new Decision(true, Math.min(MAX_DELAY_MILLIS, baseMillis + jitterMillis));
    }
}

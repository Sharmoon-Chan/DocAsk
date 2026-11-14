package com.kama.jchatmind.models;

import java.time.Duration;
import java.util.Objects;
import java.util.concurrent.Callable;
import java.util.concurrent.CompletionException;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.FutureTask;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.SynchronousQueue;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * A caller deadline for one synchronous provider request, independent of socket inactivity timeouts.
 *
 * <p>The transport pool has a fixed maximum and no queue. Cancellation is best effort: a provider
 * that ignores interruption keeps occupying its existing thread until it really returns. Such a
 * provider cannot cause replacement threads or queued requests to accumulate. Its late result is
 * discarded by the cancelled Future, so the Agent caller cannot continue with it or persist it.</p>
 *
 * <p>Only provider transport belongs here. Agent tools and message persistence remain on the caller
 * thread; provider internal tool execution must be disabled. One runtime service shares this pool
 * across all of its clients and closes it with its lifecycle.</p>
 */
public final class ModelCallDeadline implements AutoCloseable {
    public static final int DEFAULT_MAX_CONCURRENT_CALLS = 4;
    private static final AtomicInteger POOL_IDS = new AtomicInteger();
    private final ThreadPoolExecutor transport;

    public ModelCallDeadline() {
        this(DEFAULT_MAX_CONCURRENT_CALLS);
    }

    ModelCallDeadline(int maxConcurrentCalls) {
        if (maxConcurrentCalls < 1) throw new IllegalArgumentException("Transport capacity must be positive");
        int poolId = POOL_IDS.incrementAndGet();
        AtomicInteger threadIds = new AtomicInteger();
        transport = new ThreadPoolExecutor(maxConcurrentCalls, maxConcurrentCalls,
                30L, TimeUnit.SECONDS, new SynchronousQueue<>(), task -> {
                    Thread thread = new Thread(task, "docask-model-transport-" + poolId + "-" + threadIds.incrementAndGet());
                    thread.setDaemon(true);
                    return thread;
                }, new ThreadPoolExecutor.AbortPolicy());
        transport.allowCoreThreadTimeOut(true);
    }

    public <T> T call(Callable<T> request, Duration timeout) {
        Objects.requireNonNull(request, "Provider request is required");
        Objects.requireNonNull(timeout, "Provider deadline is required");
        long budgetNanos = timeout.toNanos();
        if (budgetNanos <= 0L) throw new IllegalArgumentException("Provider deadline must be positive");
        requireNotInterrupted();
        long started = System.nanoTime();
        FutureTask<T> result = new FutureTask<>(request);
        try {
            transport.execute(result);
        } catch (RejectedExecutionException capacityUnavailable) {
            result.cancel(true);
            requireNotInterrupted();
            throw failure(ModelCallFailure.Kind.UPSTREAM_UNAVAILABLE,
                    transport.isShutdown() ? "ModelTransportClosed" : "TransportCapacityUnavailable");
        }
        try {
            long remaining = budgetNanos - (System.nanoTime() - started);
            if (remaining <= 0L) throw new TimeoutException();
            T response = result.get(remaining, TimeUnit.NANOSECONDS);
            // Future.get on an already completed task may return despite a caller interrupt.
            requireNotInterrupted();
            if (System.nanoTime() - started >= budgetNanos) throw new TimeoutException();
            return response;
        } catch (InterruptedException interrupted) {
            result.cancel(true);
            Thread.currentThread().interrupt();
            throw failure(ModelCallFailure.Kind.INTERRUPTED, "InterruptedException");
        } catch (TimeoutException expired) {
            result.cancel(true);
            requireNotInterrupted();
            throw failure(ModelCallFailure.Kind.READ_TIMEOUT, "ModelCallDeadlineExceeded");
        } catch (ExecutionException failed) {
            requireNotInterrupted();
            Throwable cause = failed.getCause();
            if (cause instanceof Error error) throw error;
            if (cause instanceof RuntimeException runtime) throw runtime;
            // The SafeChatModel boundary classifies and sanitizes this original transport cause.
            throw new CompletionException(cause);
        } finally {
            if (Thread.currentThread().isInterrupted()) result.cancel(true);
        }
    }

    private static void requireNotInterrupted() {
        if (Thread.currentThread().isInterrupted()) {
            throw failure(ModelCallFailure.Kind.INTERRUPTED, "InterruptedException");
        }
    }

    private static ModelCallException failure(ModelCallFailure.Kind kind, String type) {
        return new ModelCallException(new ModelCallFailure(kind, type, null));
    }

    @Override
    public void close() {
        transport.shutdownNow();
    }
}

package com.kama.jchatmind.models;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;

import java.io.EOFException;
import java.time.Duration;
import java.util.Set;
import java.util.concurrent.CompletionException;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.*;

/** Deadline/capacity behavior with transports deliberately independent of caller cancellation. */
@Timeout(5)
class ModelCallDeadlineTest {

    @Test
    void completesOnAFixedDaemonTransportWhileTheCallerKeepsTheContinuation() {
        Thread caller = Thread.currentThread();
        AtomicReference<Thread> providerThread = new AtomicReference<>();
        try (ModelCallDeadline deadline = new ModelCallDeadline(1)) {
            String value = deadline.call(() -> {
                providerThread.set(Thread.currentThread());
                return "response";
            }, Duration.ofSeconds(1));
            assertEquals("response", value);
            assertNotSame(caller, providerThread.get());
            assertTrue(providerThread.get().isDaemon());
            assertSame(caller, Thread.currentThread(), "tools and persistence continue on the caller");
        }
    }

    @Test
    void aTransportIgnoringInterruptCannotDeliverItsLateResultOrCallerContinuation() throws Exception {
        CountDownLatch release = new CountDownLatch(1);
        CountDownLatch cancellationObserved = new CountDownLatch(1);
        CountDownLatch returnedLate = new CountDownLatch(1);
        AtomicInteger persisted = new AtomicInteger();
        try (ModelCallDeadline deadline = new ModelCallDeadline(1)) {
            long started = System.nanoTime();
            try {
                ModelCallException failure = assertThrows(ModelCallException.class, () -> {
                    String response = deadline.call(() -> {
                        awaitIgnoringInterrupt(release, cancellationObserved);
                        returnedLate.countDown();
                        return "late response";
                    }, Duration.ofMillis(150));
                    persisted.incrementAndGet();
                    fail("late provider response reached the caller: " + response);
                });
                assertEquals(ModelCallFailure.Kind.READ_TIMEOUT, failure.failure().kind());
                assertEquals("ModelCallDeadlineExceeded", failure.failure().exceptionType());
                assertNull(failure.getCause());
                assertTrue(Duration.ofNanos(System.nanoTime() - started).compareTo(Duration.ofSeconds(1)) < 0);
                assertTrue(cancellationObserved.await(1, TimeUnit.SECONDS), "timeout must cancel the Future");
                release.countDown();
                assertTrue(returnedLate.await(1, TimeUnit.SECONDS));
                assertEquals(0, persisted.get(), "a cancelled Future never resumes caller persistence");
            } finally {
                release.countDown();
            }
        }
    }

    @Test
    void aPreexistingCallerInterruptPreventsAnyRequestAndRemainsSet() {
        AtomicInteger calls = new AtomicInteger();
        try (ModelCallDeadline deadline = new ModelCallDeadline(1)) {
            try {
                Thread.currentThread().interrupt();
                ModelCallException failure = assertThrows(ModelCallException.class,
                        () -> deadline.call(calls::incrementAndGet, Duration.ofSeconds(1)));
                assertEquals(ModelCallFailure.Kind.INTERRUPTED, failure.failure().kind());
                assertTrue(Thread.currentThread().isInterrupted());
                assertEquals(0, calls.get());
            } finally {
                Thread.interrupted();
            }
        }
    }

    @Test
    void anInterruptedCallerStopsWaitingAndCancelsTheTransportWithoutLosingItsFlag() throws Exception {
        CountDownLatch entered = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        CountDownLatch cancelled = new CountDownLatch(1);
        AtomicReference<ModelCallException> observed = new AtomicReference<>();
        AtomicBoolean interruptPreserved = new AtomicBoolean();
        AtomicBoolean returned = new AtomicBoolean();
        try (ModelCallDeadline deadline = new ModelCallDeadline(1)) {
            Thread caller = new Thread(() -> {
                try {
                    deadline.call(() -> {
                        entered.countDown();
                        awaitIgnoringInterrupt(release, cancelled);
                        return "late";
                    }, Duration.ofSeconds(3));
                    returned.set(true);
                } catch (ModelCallException failure) {
                    observed.set(failure);
                    interruptPreserved.set(Thread.currentThread().isInterrupted());
                }
            });
            caller.start();
            try {
                assertTrue(entered.await(1, TimeUnit.SECONDS));
                caller.interrupt();
                caller.join(1_000);
                assertFalse(caller.isAlive(), "caller interruption must not wait for provider completion");
                assertNotNull(observed.get());
                assertEquals(ModelCallFailure.Kind.INTERRUPTED, observed.get().failure().kind());
                assertTrue(interruptPreserved.get());
                assertTrue(cancelled.await(1, TimeUnit.SECONDS));
                assertFalse(returned.get());
            } finally {
                release.countDown();
                caller.interrupt();
                caller.join(1_000);
            }
        }
    }

    @Test
    void timedOutTransportsKeepTheirSlotsUntilTheyReallyFinishAndCannotGrowThePool() throws Exception {
        CountDownLatch release = new CountDownLatch(1);
        CountDownLatch completed = new CountDownLatch(2);
        AtomicInteger calls = new AtomicInteger();
        Set<Thread> providerThreads = ConcurrentHashMap.newKeySet();
        try (ModelCallDeadline deadline = new ModelCallDeadline(2)) {
            try {
                for (int call = 0; call < 2; call++) {
                    ModelCallException timedOut = assertThrows(ModelCallException.class, () -> deadline.call(() -> {
                        calls.incrementAndGet();
                        providerThreads.add(Thread.currentThread());
                        try {
                            awaitIgnoringInterrupt(release, new CountDownLatch(1));
                            return "late";
                        } finally {
                            completed.countDown();
                        }
                    }, Duration.ofMillis(120)));
                    assertEquals(ModelCallFailure.Kind.READ_TIMEOUT, timedOut.failure().kind());
                }
                long started = System.nanoTime();
                for (int call = 0; call < 20; call++) {
                    ModelCallException rejected = assertThrows(ModelCallException.class,
                            () -> deadline.call(calls::incrementAndGet, Duration.ofSeconds(2)));
                    assertEquals(ModelCallFailure.Kind.UPSTREAM_UNAVAILABLE, rejected.failure().kind());
                    assertEquals("TransportCapacityUnavailable", rejected.failure().exceptionType());
                    assertTrue(rejected.failure().toDetail().contains("dispatch=not-started"));
                    assertFalse(rejected.failure().toDetail().contains("http="));
                    assertNull(rejected.getCause());
                }
                assertTrue(Duration.ofNanos(System.nanoTime() - started).compareTo(Duration.ofSeconds(1)) < 0);
                assertEquals(2, calls.get(), "capacity rejection must not queue or execute another request");
                assertEquals(2, providerThreads.size());
                assertTrue(providerThreads.stream().allMatch(Thread::isDaemon));
                release.countDown();
                assertTrue(completed.await(1, TimeUnit.SECONDS));
                // Completion can precede the executor's return to its handoff wait by a tiny interval.
                String recovered = null;
                long stop = System.nanoTime() + TimeUnit.SECONDS.toNanos(1);
                while (recovered == null && System.nanoTime() < stop) {
                    try {
                        recovered = deadline.call(() -> "fresh", Duration.ofMillis(100));
                    } catch (ModelCallException releasingSlot) {
                        assertEquals("TransportCapacityUnavailable", releasingSlot.failure().exceptionType());
                        Thread.sleep(5);
                    }
                }
                assertEquals("fresh", recovered, "capacity returns only after the ignored request really exits");
            } finally {
                release.countDown();
            }
        }
    }

    @Test
    void aClosedDeadlineRejectsCallsImmediatelyAndNeverExecutesThem() {
        ModelCallDeadline deadline = new ModelCallDeadline(1);
        deadline.close();
        AtomicInteger calls = new AtomicInteger();
        ModelCallException closed = assertThrows(ModelCallException.class,
                () -> deadline.call(calls::incrementAndGet, Duration.ofSeconds(1)));
        assertEquals("ModelTransportClosed", closed.failure().exceptionType());
        assertTrue(closed.failure().toDetail().contains("dispatch=not-started"));
        assertEquals(0, calls.get());
    }

    @Test
    void unknownProgrammingExceptionsAreNotRelabelledAsRetryableTransportFailures() {
        IllegalStateException programmingFailure = new IllegalStateException("fixture programming failure");
        try (ModelCallDeadline deadline = new ModelCallDeadline(1)) {
            RuntimeException observed = assertThrows(RuntimeException.class,
                    () -> deadline.call(() -> { throw programmingFailure; }, Duration.ofSeconds(1)));
            assertSame(programmingFailure, observed);
            assertEquals(ModelCallFailure.Kind.UNKNOWN, ModelCallFailure.classify(observed).kind());
            assertFalse(ModelCallFailure.classify(observed).retryable());
        }
    }

    @Test
    void errorsKeepTheirProgrammingFailureSemantics() {
        AssertionError programmingFailure = new AssertionError("fixture error");
        try (ModelCallDeadline deadline = new ModelCallDeadline(1)) {
            assertSame(programmingFailure, assertThrows(AssertionError.class,
                    () -> deadline.call(() -> { throw programmingFailure; }, Duration.ofSeconds(1))));
        }
    }

    @Test
    void checkedTransportCausesReachTheSanitizerWithoutBeingLost() {
        try (ModelCallDeadline deadline = new ModelCallDeadline(1)) {
            CompletionException observed = assertThrows(CompletionException.class,
                    () -> deadline.call(() -> { throw new EOFException("fixture closed response"); }, Duration.ofSeconds(1)));
            assertEquals(ModelCallFailure.Kind.CONNECTION_FAILURE, ModelCallFailure.classify(observed).kind());
        }
    }

    @Test
    void nonpositiveDeadlinesCannotSubmitARequest() {
        AtomicInteger calls = new AtomicInteger();
        try (ModelCallDeadline deadline = new ModelCallDeadline(1)) {
            assertThrows(IllegalArgumentException.class, () -> deadline.call(calls::incrementAndGet, Duration.ZERO));
            assertThrows(IllegalArgumentException.class, () -> deadline.call(calls::incrementAndGet, Duration.ofMillis(-1)));
            assertEquals(0, calls.get());
        }
    }

    private static void awaitIgnoringInterrupt(CountDownLatch release, CountDownLatch cancellationObserved) {
        boolean released = false;
        while (!released) {
            try {
                release.await();
                released = true;
            } catch (InterruptedException ignoredByProvider) {
                cancellationObserved.countDown();
            }
        }
    }
}

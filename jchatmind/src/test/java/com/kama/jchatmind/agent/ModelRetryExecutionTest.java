package com.kama.jchatmind.agent;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.kama.jchatmind.agent.tools.DirectAnswerTool;
import com.kama.jchatmind.converter.ChatMessageConverter;
import com.kama.jchatmind.execution.RunEventRecord;
import com.kama.jchatmind.execution.RunEventSink;
import com.kama.jchatmind.execution.RunEventStatus;
import com.kama.jchatmind.execution.RunEventType;
import com.kama.jchatmind.execution.RunRecorder;
import com.kama.jchatmind.model.dto.ChatMessageDTO;
import com.kama.jchatmind.model.dto.KnowledgeBaseDTO;
import com.kama.jchatmind.model.response.CreateChatMessageResponse;
import com.kama.jchatmind.models.ModelCallException;
import com.kama.jchatmind.models.ModelCallFailure;
import com.kama.jchatmind.models.ModelRetryPolicy;
import com.kama.jchatmind.models.ProviderFailure;
import com.kama.jchatmind.models.ProviderUnavailableException;
import com.kama.jchatmind.runs.RunCancelledException;
import com.kama.jchatmind.runs.RunLeaseLostException;
import com.kama.jchatmind.service.ChatMessageFacadeService;
import com.kama.jchatmind.service.SseService;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.ai.chat.client.ChatClient;
import org.springframework.ai.chat.messages.AssistantMessage;
import org.springframework.ai.chat.messages.Message;
import org.springframework.ai.chat.model.ChatResponse;
import org.springframework.ai.chat.model.Generation;
import org.springframework.ai.chat.prompt.Prompt;
import org.springframework.ai.tool.ToolCallback;
import org.springframework.ai.tool.annotation.Tool;
import org.springframework.ai.tool.method.MethodToolCallbackProvider;

import java.util.List;
import java.time.Duration;
import java.util.Queue;
import java.util.UUID;
import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * Replays the real Agent loop at requestModel, with real Spring AI tool callbacks.
 * Ordinary backoffs are skipped; cancellation tests exercise the production sliced waiter.
 * No provider, database, credentials or paid API calls are involved.
 */
class ModelRetryExecutionTest {
    private static final ObjectMapper JSON = new ObjectMapper().findAndRegisterModules();
    private final List<RunEventRecord> events = new CopyOnWriteArrayList<>();

    @ParameterizedTest
    @ValueSource(strings = {"http503", "readTimeout"})
    @DisplayName("503或读取超时后只重试失败的模型请求，成功与失败尝试各自留证")
    void aTransientFailureRetriesTheSameDecisionAndThenSucceeds(String failureType) {
        Harness harness = harness(List.of(transientFailure(failureType), answerRound("recovered")), () -> { });

        harness.runtime().run();

        assertEquals(AgentState.FINISHED, harness.runtime().state());
        assertEquals(2, harness.runtime().modelCalls.get());
        assertEquals(1, harness.runtime().waits.size());
        assertEquals(List.of(1, 2), modelEvents().stream().map(RunEventRecord::retryAttempt).toList());
        assertEquals(List.of(RunEventStatus.FAILED, RunEventStatus.SUCCEEDED),
                modelEvents().stream().map(RunEventRecord::status).toList());
        assertTrue(modelEvents().getFirst().detail().contains("http503".equals(failureType)
                ? "kind=UPSTREAM_UNAVAILABLE" : "kind=READ_TIMEOUT"));
        if ("http503".equals(failureType)) assertTrue(modelEvents().getFirst().detail().contains("http=503"));
        assertEquals(harness.runtime().requests.get(0), harness.runtime().requests.get(1),
                "a transport retry must preserve the decision input instead of appending another task");
        assertEquals(1, harness.saved().stream().filter(dto -> "recovered".equals(dto.getContent())).count());
    }

    @Test
    @DisplayName("401不重试，不产生虚假的成功模型事件")
    void authenticationFailureDoesNotRetry() {
        Harness harness = harness(List.of(httpFailure(401), answerRound("must-not-be-requested")), () -> { });

        runAllowingExpectedModelFailure(harness, ModelCallFailure.Kind.REQUEST_REJECTED);

        assertEquals(1, harness.runtime().modelCalls.get());
        assertTrue(harness.runtime().waits.isEmpty());
        assertEquals(1, modelEvents().size());
        assertEquals(RunEventStatus.FAILED, modelEvents().getFirst().status());
        assertTrue(modelEvents().getFirst().detail().contains("http=401"));
        assertTrue(modelEvents().getFirst().detail().contains("kind=REQUEST_REJECTED"));
        assertEquals(0, harness.tool().calls.get());
    }

    @Test
    @DisplayName("模型连续失败最多调用三次，重试耗尽仍保留失败事件")
    void threeFailedAttemptsStopWithoutAHiddenFourthRequest() {
        Harness harness = harness(List.of(httpFailure(503), httpFailure(503), httpFailure(503),
                answerRound("must-not-be-requested")), () -> { });

        runAllowingExpectedModelFailure(harness, ModelCallFailure.Kind.UPSTREAM_UNAVAILABLE);

        assertEquals(3, ModelRetryPolicy.MAX_ATTEMPTS);
        assertEquals(3, harness.runtime().modelCalls.get());
        assertEquals(2, harness.runtime().waits.size());
        assertEquals(List.of(1, 2, 3), modelEvents().stream().map(RunEventRecord::retryAttempt).toList());
        assertTrue(modelEvents().stream().allMatch(event -> event.status() == RunEventStatus.FAILED));
        assertEquals(0, harness.tool().calls.get());
    }

    @Test
    @DisplayName("门控的第二个时隙超过重试窗口时立即保留原失败，不等待30秒或发送第二次模型请求")
    void aGateReservationOutsideTheRetryWindowDoesNotStartAnotherRequest() {
        Harness harness = harness(List.of(httpFailure(503), answerRound("must-not-be-requested")), () -> { });
        AtomicInteger slots = new AtomicInteger();
        harness.runtime().attachModelRequestGate(() -> slots.incrementAndGet() == 1
                ? 0L : TimeUnit.SECONDS.toNanos(30));

        assertTimeoutPreemptively(Duration.ofSeconds(3),
                () -> runAllowingExpectedModelFailure(harness, ModelCallFailure.Kind.UPSTREAM_UNAVAILABLE));

        assertEquals(2, slots.get());
        assertEquals(1, harness.runtime().modelCalls.get(), "an unavailable retry slot is not a sent model attempt");
        assertEquals(1, modelEvents().size());
        assertEquals(RunEventStatus.FAILED, modelEvents().getFirst().status());
        assertTrue(harness.saved().isEmpty());
    }

    @ParameterizedTest
    @EnumSource(AbortKind.class)
    @DisplayName("重试时隙超预算的同时发生取消或租约失效时，控制异常优先于原模型故障")
    void invalidationWhileReservingAnOverBudgetSlotKeepsItsControlCause(AbortKind kind) {
        AtomicReference<RuntimeException> abort = new AtomicReference<>();
        Harness harness = harness(List.of(httpFailure(503), answerRound("must-not-be-requested")), () -> {
            if (abort.get() != null) throw abort.get();
        });
        AtomicInteger slots = new AtomicInteger();
        RuntimeException stop = abortFailure(kind);
        harness.runtime().attachModelRequestGate(() -> {
            if (slots.incrementAndGet() == 1) return 0L;
            abort.set(stop);
            return TimeUnit.SECONDS.toNanos(30);
        });

        RuntimeException thrown = assertThrows(RuntimeException.class, harness.runtime()::run);

        assertTrue(hasCause(thrown, stop.getClass()));
        assertEquals(1, harness.runtime().modelCalls.get());
        assertEquals(1, modelEvents().size());
        assertTrue(harness.saved().isEmpty());
    }

    @Test
    @DisplayName("工具已经执行后模型超时，只重试模型而不重放工具副作用")
    void aFailureAfterAToolCallNeverReplaysTheExecutedTool() {
        Harness harness = harness(List.of(sideEffectRound(), transientFailure("readTimeout"),
                answerRound("tool-complete")), () -> { });

        harness.runtime().run();

        assertEquals(AgentState.FINISHED, harness.runtime().state());
        assertEquals(3, harness.runtime().modelCalls.get());
        assertEquals(1, harness.tool().calls.get(), "the real callback's side effect must occur exactly once");
        assertEquals(1, events.stream().filter(event -> event.type() == RunEventType.TOOL_CALL
                && "probeSideEffect".equals(event.toolName())).count());
        assertEquals(List.of(1, 1, 2), modelEvents().stream().map(RunEventRecord::retryAttempt).toList());
        assertEquals(List.of(RunEventStatus.SUCCEEDED, RunEventStatus.FAILED, RunEventStatus.SUCCEEDED),
                modelEvents().stream().map(RunEventRecord::status).toList());
        assertEquals(harness.runtime().requests.get(1), harness.runtime().requests.get(2),
                "the retry must reuse the history containing the already completed tool result");
        assertEquals(1, harness.saved().stream().filter(dto -> "tool-complete".equals(dto.getContent())).count());
    }

    enum AbortKind { CANCEL, LEASE }

    @ParameterizedTest
    @EnumSource(AbortKind.class)
    @DisplayName("真实分片退避期间取消或失去租约，应及时停止且不发下一请求")
    void cancellationOrLeaseLossDuringRealBackoffStopsBeforeTheNextRequest(AbortKind kind) throws Exception {
        AtomicReference<RuntimeException> abort = new AtomicReference<>();
        AtomicBoolean inBackoff = new AtomicBoolean();
        CountDownLatch waitCheckpoint = new CountDownLatch(1);
        Runnable guard = () -> {
            if (inBackoff.get()) waitCheckpoint.countDown();
            RuntimeException failure = abort.get();
            if (failure != null) throw failure;
        };
        Harness harness = harness(List.of(httpFailure(503), answerRound("must-not-be-requested")), guard);
        harness.runtime().realWait = true;
        harness.runtime().beforeWait = () -> inBackoff.set(true);
        AtomicReference<Throwable> thrown = new AtomicReference<>();
        Thread worker = worker(harness.runtime(), thrown, new AtomicBoolean());
        worker.start();
        try {
            assertTrue(waitCheckpoint.await(3, TimeUnit.SECONDS), "the production waiter must invoke runtimeGuard");
            RuntimeException stop = abortFailure(kind);
            abort.set(stop);
            worker.join(2_000);
            assertFalse(worker.isAlive(), "must not wait for the full five-second backoff after invalidation");
            assertNotNull(thrown.get(), "cancel/lease failure must escape instead of entering model fallback");
            assertTrue(hasCause(thrown.get(), stop.getClass()), "the cancellation/lease cause must be retained");
            assertEquals(1, harness.runtime().modelCalls.get());
            assertEquals(1, modelEvents().size());
            assertEquals(0, harness.tool().calls.get());
            assertTrue(harness.saved().isEmpty(), "invalidation must not produce a late fallback or final answer");
        } finally {
            abort.compareAndSet(null, abortFailure(kind));
            stopWorker(worker);
        }
    }

    @Test
    @DisplayName("真实退避被线程中断后立即退出并保留中断标志，不发下一请求")
    void interruptionDuringRealBackoffStopsAndPreservesTheInterruptFlag() throws Exception {
        AtomicBoolean inBackoff = new AtomicBoolean();
        CountDownLatch waitCheckpoint = new CountDownLatch(1);
        Harness harness = harness(List.of(httpFailure(503), answerRound("must-not-be-requested")), () -> {
            if (inBackoff.get()) waitCheckpoint.countDown();
        });
        harness.runtime().realWait = true;
        harness.runtime().beforeWait = () -> inBackoff.set(true);
        AtomicReference<Throwable> thrown = new AtomicReference<>();
        AtomicBoolean interruptedOnExit = new AtomicBoolean();
        Thread worker = worker(harness.runtime(), thrown, interruptedOnExit);
        worker.start();
        try {
            assertTrue(waitCheckpoint.await(3, TimeUnit.SECONDS), "the request must reach the real backoff");
            worker.interrupt();
            worker.join(2_000);
            assertFalse(worker.isAlive(), "interrupt must stop the wait promptly");
            assertNotNull(thrown.get(), "interrupt must not be swallowed or treated as a retryable outage");
            assertTrue(interruptedOnExit.get(), "cooperative cancellation must preserve the interrupt flag");
            assertEquals(1, harness.runtime().modelCalls.get());
            assertEquals(1, modelEvents().size());
            assertEquals(0, harness.tool().calls.get());
            assertTrue(harness.saved().isEmpty());
        } finally {
            stopWorker(worker);
        }
    }

    @ParameterizedTest
    @EnumSource(AbortKind.class)
    @DisplayName("退避返回后再次检查取消与租约，不得直接发送下一请求")
    void anInvalidationAtTheEndOfBackoffIsRecheckedBeforeSending(AbortKind kind) {
        AtomicReference<RuntimeException> abort = new AtomicReference<>();
        Harness harness = harness(List.of(httpFailure(503), answerRound("must-not-be-requested")), () -> {
            RuntimeException failure = abort.get();
            if (failure != null) throw failure;
        });
        RuntimeException stop = abortFailure(kind);
        // Deliberately bypass the default waiter's checks: the caller must recheck before sending.
        harness.runtime().beforeWait = () -> abort.set(stop);

        RuntimeException thrown = assertThrows(RuntimeException.class, harness.runtime()::run);

        assertTrue(hasCause(thrown, stop.getClass()));
        assertEquals(1, harness.runtime().modelCalls.get());
        assertEquals(1, harness.runtime().waits.size());
        assertEquals(1, modelEvents().size());
        assertEquals(0, harness.tool().calls.get());
    }

    private Harness harness(List<?> script, Runnable guard) {
        List<ChatMessageDTO> saved = new CopyOnWriteArrayList<>();
        ChatMessageFacadeService messages = mock(ChatMessageFacadeService.class);
        when(messages.createChatMessage(any(ChatMessageDTO.class))).thenAnswer(invocation -> {
            ChatMessageDTO dto = invocation.getArgument(0);
            saved.add(dto);
            return CreateChatMessageResponse.builder().chatMessageId("saved-" + saved.size()).build();
        });
        CountingTool tool = new CountingTool();
        ToolCallback[] callbacks = MethodToolCallbackProvider.builder()
                .toolObjects(tool, new DirectAnswerTool()).build().getToolCallbacks();
        ScriptedRuntime runtime = new ScriptedRuntime(script, callbacks, messages, guard);
        RunEventSink sink = new RunEventSink() {
            @Override public void append(RunEventRecord event) { events.add(event); }
            @Override public void touch(String runId) { }
            @Override public void setAnswerMessageId(String runId, String messageId) { }
        };
        runtime.attachRun(new RunRecorder("retry-" + UUID.randomUUID(), sink, System.nanoTime()));
        return new Harness(runtime, tool, saved);
    }

    private record Harness(ScriptedRuntime runtime, CountingTool tool, List<ChatMessageDTO> saved) { }

    private List<RunEventRecord> modelEvents() {
        return events.stream().filter(event -> event.type() == RunEventType.MODEL_CALL
                || event.type() == RunEventType.MODEL_RETRY).toList();
    }

    private static void runAllowingExpectedModelFailure(Harness harness, ModelCallFailure.Kind kind) {
        try {
            harness.runtime().run();
        } catch (RuntimeException expected) {
            assertEquals(kind, ModelCallFailure.classify(expected).kind(),
                    "a safe model error is allowed, an unrelated implementation error is not");
        }
        // The runtime may alternatively deliver an explicitly degraded response. Its failed model
        // events and call-count assertions still apply, so this cannot mask a retry or a tool replay.
    }

    private static RuntimeException transientFailure(String type) {
        return "http503".equals(type) ? httpFailure(503) : new ModelCallException(new ModelCallFailure(
                ModelCallFailure.Kind.READ_TIMEOUT, "SocketTimeoutException", null));
    }

    private static RuntimeException httpFailure(int status) {
        return new ProviderUnavailableException(new ProviderFailure(status, "unknown", "unknown", "request-fixture"));
    }

    private static RuntimeException abortFailure(AbortKind kind) {
        return kind == AbortKind.CANCEL ? new RunCancelledException("fixture cancelled")
                : new RunLeaseLostException("fixture lease lost");
    }

    private static boolean hasCause(Throwable failure, Class<?> expected) {
        for (int depth = 0; failure != null && depth < 32; depth++, failure = failure.getCause()) {
            if (expected.isInstance(failure)) return true;
        }
        return false;
    }

    private static Thread worker(ScriptedRuntime runtime, AtomicReference<Throwable> thrown,
                                 AtomicBoolean interruptedOnExit) {
        Thread worker = new Thread(() -> {
            try {
                runtime.run();
            } catch (Throwable failure) {
                thrown.set(failure);
            } finally {
                interruptedOnExit.set(Thread.currentThread().isInterrupted());
            }
        }, "model-retry-cancellation-probe");
        worker.setDaemon(true);
        return worker;
    }

    private static void stopWorker(Thread worker) throws InterruptedException {
        if (worker.isAlive()) worker.interrupt();
        worker.join(2_000);
    }

    private static ChatResponse sideEffectRound() {
        return toolRound("work-once", "probeSideEffect", "{}");
    }

    private static ChatResponse answerRound(String answer) {
        return toolRound("answer-final", "directAnswer", "{\"answer\":\"" + answer + "\"}");
    }

    private static ChatResponse toolRound(String id, String name, String arguments) {
        AssistantMessage response = AssistantMessage.builder().content("")
                .toolCalls(List.of(new AssistantMessage.ToolCall(id, "function", name, arguments))).build();
        return new ChatResponse(List.of(new Generation(response)));
    }

    private static final class ScriptedRuntime extends JChatMind {
        private final Queue<Object> script;
        private final AtomicInteger modelCalls = new AtomicInteger();
        private final List<List<Message>> requests = new CopyOnWriteArrayList<>();
        private final List<Long> waits = new CopyOnWriteArrayList<>();
        private boolean realWait;
        private Runnable beforeWait = () -> { };

        ScriptedRuntime(List<?> script, ToolCallback[] callbacks, ChatMessageFacadeService messages, Runnable guard) {
            super("11111111-1111-4111-8111-111111111111", "retry-fixture", "fixture", "fixture",
                    mock(ChatClient.class), 20, List.<Message>of(), List.of(callbacks),
                    List.<KnowledgeBaseDTO>of(), "22222222-2222-4222-8222-222222222222",
                    mock(SseService.class), messages, new ChatMessageConverter(JSON), guard,
                    "请执行一次测试工具再给出答复");
            this.script = new ConcurrentLinkedQueue<>(script);
        }

        @Override
        ChatResponse requestModel(Prompt prompt, String thinkPrompt) {
            modelCalls.incrementAndGet();
            requests.add(List.copyOf(prompt.getInstructions()));
            Object step = script.poll();
            assertNotNull(step, "the runtime issued an unscripted model request");
            if (step instanceof RuntimeException failure) throw failure;
            return (ChatResponse) step;
        }

        @Override
        void waitBeforeModelRetry(long delayMillis) {
            waits.add(delayMillis);
            beforeWait.run();
            if (realWait) super.waitBeforeModelRetry(5_000L);
        }
    }

    public static final class CountingTool {
        private final AtomicInteger calls = new AtomicInteger();

        @Tool(name = "probeSideEffect", description = "Record one fixture side effect")
        public String execute() {
            calls.incrementAndGet();
            return "work-completed-once";
        }
    }
}

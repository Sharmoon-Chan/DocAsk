package com.kama.jchatmind.agent;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.kama.jchatmind.agent.tools.DirectAnswerTool;
import com.kama.jchatmind.agent.tools.GroundedAnswerTool;
import com.kama.jchatmind.agent.tools.SourceAnswerTool;
import com.kama.jchatmind.agent.tools.TerminateTool;
import com.kama.jchatmind.converter.ChatMessageConverter;
import com.kama.jchatmind.model.dto.ChatMessageDTO;
import com.kama.jchatmind.model.dto.KnowledgeBaseDTO;
import com.kama.jchatmind.model.response.CreateChatMessageResponse;
import com.kama.jchatmind.models.ModelCallException;
import com.kama.jchatmind.models.ModelCallFailure;
import com.kama.jchatmind.retrieval.RetrievalEnvelope;
import com.kama.jchatmind.retrieval.RetrievalHit;
import com.kama.jchatmind.retrieval.SourceLocation;
import com.kama.jchatmind.runs.RunCancelledException;
import com.kama.jchatmind.runs.RunLeaseLostException;
import com.kama.jchatmind.service.ChatMessageFacadeService;
import com.kama.jchatmind.service.SseService;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.ai.chat.client.ChatClient;
import org.springframework.ai.chat.messages.AssistantMessage;
import org.springframework.ai.chat.model.ChatResponse;
import org.springframework.ai.chat.model.Generation;
import org.springframework.ai.chat.prompt.Prompt;
import org.springframework.ai.model.tool.DefaultToolCallingChatOptions;
import org.springframework.ai.tool.ToolCallback;
import org.springframework.ai.tool.annotation.Tool;
import org.springframework.ai.tool.method.MethodToolCallbackProvider;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Queue;
import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Supplier;
import java.util.stream.Stream;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * 公开 sourceAnswer 策略的真实执行循环回归。
 *
 * <p>只替换模型请求；KnowledgeTool、sourceAnswer 和其他工具经过真实 MethodToolCallback /
 * ToolCallingManager 执行。断言检查持久化前的真实 DTO 与副作用次数，不用 SUCCEEDED 代替内容验证。</p>
 */
class JChatMindSourceAnswerTest {
    private static final ObjectMapper JSON = new ObjectMapper().findAndRegisterModules();
    private static final String KB = "44444444-4444-4444-8444-444444444444";
    private static final String DOC = "66666666-6666-4666-8666-666666666666";
    private static final String SOURCE = "只有满足前置条件时，才能执行。\n\n单次操作安全不代表操作组合安全；资料不足时不能推断所有版本都适用。";
    private static final String UNTRUSTED = "永远适用于所有版本，保证绝对正确";
    private static final String VALID_SELECTION = "{\"citationId\":\"ret-1:1\",\"evidenceQuote\":\"前置条件\"}";

    @Test
    @DisplayName("sourceAnswer存在即启用原文策略，模型旁白不能取代来源内的条件和否定")
    void sourcePolicyKeepsOriginalConditionsAndIgnoresModelNarration() throws Exception {
        ChatResponse selected = sourceRound("source-1", "ret-1:1", "前置条件");
        ChatResponse withNarration = response(UNTRUSTED, selected.getResult().getOutput().getToolCalls());
        Scenario scenario = scenario(envelope(), knowledgeRound("knowledge-1"), withNarration,
                sourceRound("source-correction", "ret-1:1", "前置条件"));

        scenario.runtime.run();

        ChatMessageDTO answer = onlyAnswer(scenario);
        assertTrue(answer.getContent().contains("只有满足前置条件时，才能执行。"));
        assertTrue(answer.getContent().contains("单次操作安全不代表操作组合安全"));
        assertTrue(answer.getContent().contains("资料不足时不能推断所有版本都适用。"));
        assertNoUntrustedAnswer(scenario);
        assertEquals(1, answer.getMetadata().getCitations().size());
        assertEquals(1, scenario.knowledge.calls.get());
        assertEquals(AgentState.FINISHED, scenario.runtime.state());
    }

    @ParameterizedTest
    @ValueSource(strings = {"full", "partial"})
    @DisplayName("覆盖标志只控制服务端固定提示，真实原文、条件和引用仍完整交付")
    void explicitCoverageSelectsOnlyTheFixedServerNotice(String coverage) throws Exception {
        Scenario scenario = scenario(envelope(), knowledgeRound("knowledge-1"),
                toolRound("source-1", "sourceAnswer", "{\"sources\":[" + VALID_SELECTION
                        + "],\"coverage\":\"" + coverage + "\"}"));

        scenario.runtime.run();

        ChatMessageDTO answer = onlyAnswer(scenario);
        assertEquals("partial".equals(coverage), answer.getContent().startsWith(GroundedAnswerAssembler.PARTIAL_PREFIX));
        assertTrue(answer.getContent().contains("只有满足前置条件时，才能执行。"));
        assertTrue(answer.getContent().contains("资料不足时不能推断所有版本都适用。"));
        assertEquals(1, answer.getMetadata().getCitations().size());
        assertEquals(1, scenario.knowledge.calls.get());
        assertEquals(2, scenario.runtime.modelCalls.get());
        assertEquals(AgentState.FINISHED, scenario.runtime.state());
    }

    @Test
    @DisplayName("明确跨系统保证缺少所选范围原文时，full先拒绝并仅修正为partial交付一次")
    void missingCrossResourceScopeRequiresOneCorrectionToPartial() throws Exception {
        String local = "操作A只在本地检查与写入。操作B需要单独提交，顺序执行不代表组合原子性。";
        String data = JSON.writeValueAsString(RetrievalEnvelope.ok("ret-1", List.of(
                hit("ret-1:1", "local-scope", local, 1, 3, 3))));
        Scenario scenario = scripted(data, List.of(step(knowledgeRound("knowledge-1")),
                step(sourceRound("source-full", "ret-1:1", "本地检查")),
                step(toolRound("source-partial", "sourceAnswer", "{\"sources\":[{\"citationId\":\"ret-1:1\","
                        + "\"evidenceQuote\":\"本地检查\"}],\"coverage\":\"partial\"}"))),
                () -> { }, null, "跨系统的两个资源能保证同一次原子提交和回滚吗？");

        scenario.runtime.run();

        ChatMessageDTO answer = onlyAnswer(scenario);
        assertTrue(answer.getContent().startsWith(GroundedAnswerAssembler.PARTIAL_PREFIX));
        assertTrue(answer.getContent().contains(local));
        assertFalse(answer.getContent().contains("原文参考"));
        assertEquals(3, scenario.runtime.modelCalls.get(), "full must be rejected before one correction");
        assertEquals(1, scenario.knowledge.calls.get(), "no completed tool is replayed");
        assertEquals(List.of(1), scenario.retrievalCountsAtAnswer);
    }

    @Test
    @DisplayName("真实所选原文含跨作用范围说明时允许full，不把窄guard宣传成语义证明")
    void selectedOriginalCrossResourceScopeAllowsFullDelivery() throws Exception {
        String original = "本地事务只能管理当前资源，跨系统的远端接口不会因为本地回滚自动撤销。";
        String data = JSON.writeValueAsString(RetrievalEnvelope.ok("ret-1", List.of(
                hit("ret-1:1", "cross-scope", original, 1, 3, 3))));
        Scenario scenario = scripted(data, List.of(step(knowledgeRound("knowledge-1")),
                step(sourceRound("source-full", "ret-1:1", "远端接口"))),
                () -> { }, null, "跨资源操作能保证随同当前事务一起回滚吗？");

        scenario.runtime.run();

        ChatMessageDTO answer = onlyAnswer(scenario);
        assertTrue(answer.getContent().startsWith(GroundedAnswerAssembler.EXTRACTIVE_PREFIX));
        assertTrue(answer.getContent().contains(original));
        assertEquals(2, scenario.runtime.modelCalls.get());
        assertEquals(1, scenario.knowledge.calls.get());
        assertEquals(1, answer.getMetadata().getCitations().size());
    }

    @Test
    @DisplayName("已召回但未选中的相邻跨资源段落不能给当前full借用范围依据")
    void anUnselectedAdjacentScopeCannotBypassCrossResourceCoverage() throws Exception {
        String local = "当前资源可执行检查与修改，操作完成后才释放本地锁。";
        String adjacent = "跨服务动作不受本地事务的自动回滚管理。";
        String data = JSON.writeValueAsString(RetrievalEnvelope.ok("ret-1", List.of(
                hit("ret-1:1", "local", local, 1, 3, 3),
                hit("ret-1:2", "adjacent", adjacent, 2, 9, 9))));
        Scenario scenario = scripted(data, List.of(step(knowledgeRound("knowledge-1")),
                step(sourceRound("source-full", "ret-1:1", "本地锁")),
                step(toolRound("source-partial", "sourceAnswer", "{\"sources\":[{\"citationId\":\"ret-1:1\","
                        + "\"evidenceQuote\":\"本地锁\"}],\"coverage\":\"partial\"}"))),
                () -> { }, null, "跨服务提交能保证同一次回滚吗？");

        scenario.runtime.run();

        ChatMessageDTO answer = onlyAnswer(scenario);
        assertTrue(answer.getContent().startsWith(GroundedAnswerAssembler.PARTIAL_PREFIX));
        assertFalse(answer.getContent().contains(adjacent), "only selected original bodies are scope evidence");
        assertEquals(List.of("ret-1:1"), answer.getMetadata().getCitations().stream()
                .map(citation -> citation.citationId()).toList());
        assertEquals(3, scenario.runtime.modelCalls.get());
    }

    @Test
    @DisplayName("普通单系统资源事务问题不因没有跨资源词而误拒full")
    void aSingleResourceQuestionDoesNotRequireCrossResourceVocabulary() throws Exception {
        String original = "当前资源的事务在提交前可以回滚，提交后的处理需要另外的业务机制。";
        String data = JSON.writeValueAsString(RetrievalEnvelope.ok("ret-1", List.of(
                hit("ret-1:1", "single", original, 1, 3, 3))));
        Scenario scenario = scripted(data, List.of(step(knowledgeRound("knowledge-1")),
                step(sourceRound("source-full", "ret-1:1", "提交前"))),
                () -> { }, null, "当前资源的事务在提交前可以回滚吗？");

        scenario.runtime.run();

        assertTrue(onlyAnswer(scenario).getContent().startsWith(GroundedAnswerAssembler.EXTRACTIVE_PREFIX));
        assertEquals(2, scenario.runtime.modelCalls.get(), "ordinary questions must not be over-rejected");
        assertEquals(1, scenario.knowledge.calls.get());
    }

    @Test
    @DisplayName("连续缺少跨资源范围的full不可落库，修正耗尽只给明确未确认原文参考")
    void repeatedMissingCrossResourceScopeNeverPersistsFalseFullDelivery() throws Exception {
        String local = "单次操作只执行本地检查和写入，多个操作需要各自检查条件。";
        String data = JSON.writeValueAsString(RetrievalEnvelope.ok("ret-1", List.of(
                hit("ret-1:1", "local", local, 1, 3, 3))));
        Scenario scenario = scripted(data, List.of(step(knowledgeRound("knowledge-1")),
                step(sourceRound("source-full-1", "ret-1:1", "本地检查")),
                step(sourceRound("source-full-2", "ret-1:1", "本地检查"))),
                () -> { }, null, "跨数据库修改能保证一起原子提交吗？");

        scenario.runtime.run();

        ChatMessageDTO answer = onlyAnswer(scenario);
        assertTrue(answer.getContent().startsWith("自动整理暂未完成，本次未能确认你的问题。"));
        assertTrue(answer.getContent().contains("原文参考"));
        assertTrue(answer.getContent().contains(local));
        assertTrue(answer.getMetadata().getToolCalls() == null || answer.getMetadata().getToolCalls().isEmpty(),
                "no rejected full sourceAnswer may become the persisted delivery");
        assertEquals(3, scenario.runtime.modelCalls.get());
        assertEquals(1, scenario.knowledge.calls.get());
        assertEquals(AgentState.FINISHED, scenario.runtime.state());
    }

    @ParameterizedTest
    @ValueSource(strings = {"unknown-id", "another-chunks-anchor"})
    @DisplayName("编造ID或跨片段锚点能修正一次，且不会重放已完成的检索")
    void invalidEvidenceCanBeCorrectedWithoutReplayingRetrieval(String error) throws Exception {
        String data = JSON.writeValueAsString(RetrievalEnvelope.ok("ret-1", List.of(
                hit("ret-1:1", "chunk-a", SOURCE, 1, 3, 5),
                hit("ret-1:2", "chunk-b", "另一节只介绍持久化。", 2, 9, 9))));
        ChatResponse invalid = error.equals("unknown-id")
                ? sourceRound("source-bad", "other-run:1", "前置条件")
                : sourceRound("source-bad", "ret-1:1", "持久化");
        Scenario scenario = scenario(data, knowledgeRound("knowledge-1"), invalid,
                sourceRound("source-good", "ret-1:1", "前置条件"));

        scenario.runtime.run();

        assertTrue(onlyAnswer(scenario).getContent().contains("只有满足前置条件时"));
        assertEquals(3, scenario.runtime.modelCalls.get(), "一次初始交付加一次修正，不额外请求模型");
        assertEquals(1, scenario.knowledge.calls.get(), "修正交付不能重放已经完成的检索");
        assertEquals(AgentState.FINISHED, scenario.runtime.state());
    }

    @Test
    @DisplayName("连续两次来源错误后只交付标明参考的真实原文，不继续追问模型")
    void repeatedInvalidEvidenceFallsBackAfterOneCorrection() throws Exception {
        Scenario scenario = scenario(envelope(), knowledgeRound("knowledge-1"),
                sourceRound("source-bad-1", "invented:1", "前置条件"),
                sourceRound("source-bad-2", "invented:2", "前置条件"));

        scenario.runtime.run();

        assertOriginalReferenceFallback(scenario);
        assertEquals(3, scenario.runtime.modelCalls.get());
        assertEquals(1, scenario.knowledge.calls.get());
    }

    @ParameterizedTest
    @MethodSource("invalidSourceArguments")
    @DisplayName("空列表、混合参数、自由字段和错误类型均需修正后才能交付")
    void malformedSourceArgumentsCannotSmuggleGeneratedFacts(String arguments) throws Exception {
        Scenario scenario = scenario(envelope(), knowledgeRound("knowledge-1"),
                toolRound("source-bad", "sourceAnswer", arguments),
                sourceRound("source-good", "ret-1:1", "前置条件"));

        scenario.runtime.run();

        assertTrue(onlyAnswer(scenario).getContent().contains("只有满足前置条件时"));
        assertNoUntrustedAnswer(scenario);
        assertEquals(3, scenario.runtime.modelCalls.get(), "非法结构必须先补正，不能静默忽略字段后交付");
        assertEquals(1, scenario.knowledge.calls.get());
    }

    static Stream<String> invalidSourceArguments() {
        String sources = "\"sources\":[" + VALID_SELECTION + "]";
        return Stream.of(
                "{\"sources\":[]}",
                "{" + sources + ",\"insufficient\":true}",
                "{" + sources + ",\"answer\":\"" + UNTRUSTED + "\"}",
                "{" + sources + ",\"text\":\"" + UNTRUSTED + "\"}",
                "{" + sources + ",\"reason\":\"" + UNTRUSTED + "\"}",
                "{\"sources\":[{\"citationId\":\"ret-1:1\",\"evidenceQuote\":\"前置条件\",\"text\":\"" + UNTRUSTED + "\"}]}",
                "{\"insufficient\":\"true\"}",
                "{\"insufficient\":false}",
                "{\"sources\":null}",
                "{\"sources\":[{\"citationId\":\"ret-1:1\",\"evidenceQuote\":123}]}",
                "{" + sources + ",\"coverage\":\"unknown\"}",
                "{" + sources + ",\"coverage\":\"PARTIAL\"}",
                "{" + sources + ",\"coverage\":true}",
                "{" + sources + ",\"coverage\":7}",
                "{" + sources + ",\"coverage\":null}",
                "{" + sources + ",\"coverage\":\"partial\",\"reason\":\"" + UNTRUSTED + "\"}",
                "{\"coverage\":\"partial\"}",
                "{\"insufficient\":true,\"coverage\":\"partial\"}",
                "{\"insufficient\":true,\"coverage\":\"full\"}",
                "{\"sources\":[" + String.join(",", VALID_SELECTION, VALID_SELECTION, VALID_SELECTION, VALID_SELECTION) + "]}");
    }

    @ParameterizedTest
    @ValueSource(strings = {"content", "directAnswer", "groundedAnswer"})
    @DisplayName("普通content与旧答复工具不能绕过实际sourceAnswer策略")
    void legacyDeliveryPathsCannotBypassSourcePolicy(String route) throws Exception {
        ChatResponse bypass = switch (route) {
            case "content" -> response(UNTRUSTED, List.of());
            case "directAnswer" -> toolRound("bypass", route, "{\"answer\":\"" + UNTRUSTED + "\"}");
            default -> toolRound("bypass", route, "{\"statements\":[{\"text\":\"" + UNTRUSTED
                    + "\",\"citationId\":\"ret-1:1\",\"evidenceQuote\":\"前置条件\"}]}");
        };
        Scenario scenario = scenario(envelope(), knowledgeRound("knowledge-1"), bypass,
                sourceRound("source-good", "ret-1:1", "前置条件"));

        scenario.runtime.run();

        assertNoUntrustedAnswer(scenario);
        assertTrue(onlyAnswer(scenario).getContent().contains("单次操作安全不代表操作组合安全"));
        assertEquals(3, scenario.runtime.modelCalls.get());
    }

    @Test
    @DisplayName("未检索的insufficient被拒绝，回退真实检索但不能把未经选择的近邻当成答复")
    void insufficientBeforeRetrievalCannotPretendTheCorpusWasChecked() throws Exception {
        Scenario scenario = scenario(envelope(),
                toolRound("insufficient-1", "sourceAnswer", "{\"insufficient\":true}"),
                toolRound("insufficient-2", "sourceAnswer", "{\"insufficient\":true}"));

        scenario.runtime.run();

        ChatMessageDTO answer = onlyAnswer(scenario);
        assertTrue(answer.getContent().startsWith("自动整理暂未完成，本次未能确认你的问题。"));
        assertTrue(answer.getContent().contains("请稍后重试"));
        assertFalse(answer.getContent().contains(SOURCE), "没有可靠选择来源时，近邻资料不能冒充本题答案");
        assertTrue(answer.getMetadata().getCitations() == null || answer.getMetadata().getCitations().isEmpty());
        assertNotEquals(GroundedAnswerAssembler.INSUFFICIENT_PREFIX, answer.getContent());
        assertEquals(1, scenario.knowledge.calls.get(), "服务器回退必须执行一次真实检索");
        assertEquals(List.of(1), scenario.retrievalCountsAtAnswer, "原文只能在真实工具执行后落库");
        assertEquals(2, scenario.runtime.modelCalls.get());
    }

    @ParameterizedTest
    @ValueSource(strings = {"no-knowledge-tool", "no-authorized-knowledge-base"})
    @DisplayName("没有可用检索工具或获准知识库时，不能无依据地成功交付资料不足")
    void insufficientWithoutUsableRetrievalCannotSucceed(String unavailable) throws Exception {
        Scenario scenario = scenario(envelope(),
                toolRound("insufficient-1", "sourceAnswer", "{\"insufficient\":true}"),
                toolRound("insufficient-2", "sourceAnswer", "{\"insufficient\":true}"));
        if (unavailable.equals("no-knowledge-tool")) {
            @SuppressWarnings("unchecked")
            List<ToolCallback> current = (List<ToolCallback>) ReflectionTestUtils.getField(scenario.runtime, "availableTools");
            assertNotNull(current);
            ToolCallback[] withoutRetrieval = current.stream()
                    .filter(tool -> !"KnowledgeTool".equals(tool.getToolDefinition().name()))
                    .toArray(ToolCallback[]::new);
            ReflectionTestUtils.setField(scenario.runtime, "availableTools", List.of(withoutRetrieval));
            ReflectionTestUtils.setField(scenario.runtime, "chatOptions", DefaultToolCallingChatOptions.builder()
                    .internalToolExecutionEnabled(false).toolCallbacks(withoutRetrieval).build());
        } else {
            ReflectionTestUtils.setField(scenario.runtime, "availableKbs", List.of());
        }

        runAllowingFailure(scenario);

        assertEquals(AgentState.ERROR, scenario.runtime.state());
        assertTrue(answerMessages(scenario.saved).isEmpty());
        assertEquals(0, scenario.knowledge.calls.get());
        assertEquals(2, scenario.runtime.modelCalls.get());
    }

    @Test
    @DisplayName("真实NO_MATCH检索后可交付固定资料不足，不能依赖非空引用登记判断检索是否发生")
    void actualNoMatchRetrievalAllowsFixedInsufficientDelivery() throws Exception {
        String noMatch = JSON.writeValueAsString(RetrievalEnvelope.noMatch("ret-1", "NO_MATCH"));
        Scenario scenario = scenario(noMatch, knowledgeRound("knowledge-1"),
                toolRound("insufficient-1", "sourceAnswer", "{\"insufficient\":true}"));

        scenario.runtime.run();

        ChatMessageDTO answer = onlyAnswer(scenario);
        assertEquals(GroundedAnswerAssembler.INSUFFICIENT_PREFIX, answer.getContent());
        assertTrue(answer.getMetadata().getCitations() == null || answer.getMetadata().getCitations().isEmpty());
        assertEquals(1, scenario.knowledge.calls.get());
        assertEquals(AgentState.FINISHED, scenario.runtime.state());
    }

    @Test
    @DisplayName("混合Knowledge与交付的批次不能先执行检索或先持久化答案")
    void mixedRetrievalAndDeliveryBatchIsRejectedBeforeEitherExecutes() throws Exception {
        List<AssistantMessage.ToolCall> mixed = List.of(
                knowledgeCall("mixed-knowledge"),
                sourceCall("mixed-answer", "ret-1:1", "前置条件"));
        Scenario scenario = scenario(envelope(), response(UNTRUSTED, mixed),
                knowledgeRound("knowledge-alone"), sourceRound("source-alone", "ret-1:1", "前置条件"));

        scenario.runtime.run();

        assertEquals(1, scenario.knowledge.calls.get(), "只有后续独立KnowledgeTool批次可以执行");
        assertEquals(List.of(1), scenario.retrievalCountsAtAnswer, "答案不能在真实检索前落库");
        assertNoUntrustedAnswer(scenario);
        assertEquals(1, onlyAnswer(scenario).getMetadata().getCitations().size());
    }

    @Test
    @DisplayName("即使副作用工具回调被装入，公开来源策略也不能执行它")
    void sourcePolicyCannotExecuteAnAvailableSideEffectTool() throws Exception {
        Scenario scenario = scenario(envelope(), knowledgeRound("knowledge-1"),
                toolRound("forbidden", "dangerousWrite", "{}"),
                sourceRound("source-good", "ret-1:1", "前置条件"));

        runAllowingFailure(scenario);

        assertEquals(0, scenario.sideEffect.calls.get());
        assertEquals(1, scenario.knowledge.calls.get());
        assertNoUntrustedAnswer(scenario);
    }

    @Test
    @DisplayName("临时模型故障耗尽重试后可返回真实原文参考，不能重复执行检索")
    void aTemporaryModelFailureCanFallBackToAlreadyRetrievedSources() throws Exception {
        RuntimeException timeout = new ModelCallException(new ModelCallFailure(
                ModelCallFailure.Kind.READ_TIMEOUT, "SocketTimeoutException", null));
        Scenario scenario = scripted(envelope(), List.of(step(knowledgeRound("knowledge-1"))),
                () -> { }, timeout, "根据资料解释操作的适用条件");

        scenario.runtime.run();

        assertOriginalReferenceFallback(scenario);
        assertEquals(1, scenario.knowledge.calls.get());
        assertTrue(scenario.runtime.modelCalls.get() >= 2 && scenario.runtime.modelCalls.get() <= 4,
                "模型失败处理必须有界，不能转化成20步重复请求");
        assertEquals(0, scenario.sideEffect.calls.get());
    }

    @Test
    @DisplayName("首次模型故障后的服务器检索不能把无关近邻伪装成已选择的来源回答")
    void aColdModelFailureDoesNotPublishArbitraryNearestRows() throws Exception {
        RuntimeException invalidResponse = new ModelCallException(new ModelCallFailure(
                ModelCallFailure.Kind.INVALID_RESPONSE, "InvalidResponse", null));
        Scenario scenario = scripted(envelope(), List.of(), () -> { }, invalidResponse,
                "请给出未记录的真实业务订单数和恢复时长");

        scenario.runtime.run();

        ChatMessageDTO answer = onlyAnswer(scenario);
        assertTrue(answer.getContent().startsWith("自动整理暂未完成，本次未能确认你的问题。"));
        assertTrue(answer.getContent().contains("请稍后重试"));
        assertFalse(answer.getContent().contains(SOURCE));
        assertTrue(answer.getMetadata().getCitations() == null || answer.getMetadata().getCitations().isEmpty());
        assertEquals(1, scenario.knowledge.calls.get(), "可读检索确实发生，但不据此断言来源回答了业务问题");
        assertEquals(1, scenario.runtime.modelCalls.get());
        assertEquals(0, scenario.sideEffect.calls.get());
    }

    @Test
    @DisplayName("复合问题参考回退先保留每次真实检索，第一组不能占满预算并挤掉第二部分")
    void referenceFallbackRepresentsEachCompletedRetrievalBeforeFillingTheBudget() throws Exception {
        String first = JSON.writeValueAsString(RetrievalEnvelope.ok("ret-1", List.of(
                hit("ret-1:1", "chunk-a", SOURCE, 1, 3, 5),
                hit("ret-1:2", "chunk-b", "同一主题的第二项资料。", 2, 8, 8),
                hit("ret-1:3", "chunk-c", "同一主题的第三项资料。", 3, 10, 10))));
        String second = JSON.writeValueAsString(RetrievalEnvelope.ok("ret-2", List.of(
                hit("ret-2:1", "chunk-other", "第二部分的独立机制与适用边界。", 1, 20, 20))));
        RuntimeException invalidResponse = new ModelCallException(new ModelCallFailure(
                ModelCallFailure.Kind.INVALID_RESPONSE, "InvalidResponse", null));
        Scenario scenario = scripted(first, List.of(step(knowledgeRound("knowledge-1")),
                step(knowledgeRound("knowledge-2"))), () -> { }, invalidResponse, "分别解释两部分的适用条件");
        scenario.knowledge.laterEnvelopes.add(second);

        scenario.runtime.run();

        ChatMessageDTO answer = onlyAnswer(scenario);
        assertEquals(List.of("ret-1:1", "ret-1:2", "ret-2:1"),
                answer.getMetadata().getCitations().stream().map(citation -> citation.citationId()).toList());
        assertTrue(answer.getContent().contains("第二部分的独立机制与适用边界"));
        assertTrue(answer.getContent().contains("本次未能确认你的问题"), "跨组保留仍不能冒充完整语义验证");
        assertEquals(2, scenario.knowledge.calls.get(), "已完成的工具不能因回退重复执行");
    }

    @Test
    @DisplayName("模型故障且检索无匹配时仍保留故障语境，不伪装为正常的资料不足判断")
    void failureWithNoMatchesKeepsItsFailureContext() throws Exception {
        String noMatch = JSON.writeValueAsString(RetrievalEnvelope.noMatch("ret-1", "NO_MATCH"));
        RuntimeException invalidResponse = new ModelCallException(new ModelCallFailure(
                ModelCallFailure.Kind.INVALID_RESPONSE, "InvalidResponse", null));
        Scenario scenario = scripted(noMatch, List.of(step(knowledgeRound("knowledge-1"))),
                () -> { }, invalidResponse, "请查询资料中的实际业务数据");

        scenario.runtime.run();

        ChatMessageDTO answer = onlyAnswer(scenario);
        assertTrue(answer.getContent().startsWith("自动整理暂未完成，本次未能确认你的问题。"));
        assertTrue(answer.getContent().contains("请稍后重试"));
        assertFalse(answer.getContent().equals(GroundedAnswerAssembler.INSUFFICIENT_PREFIX));
        assertTrue(answer.getMetadata().getCitations() == null || answer.getMetadata().getCitations().isEmpty());
        assertEquals(1, scenario.knowledge.calls.get());
        assertEquals(2, scenario.runtime.modelCalls.get());
    }

    @Test
    @DisplayName("未知编程异常不能被吞掉并伪装为正常原文回退")
    void aProgrammingFailureDoesNotBecomeSuccessfulFallback() throws Exception {
        Scenario scenario = scripted(envelope(), List.of(step(knowledgeRound("knowledge-1"))),
                () -> { }, new IllegalStateException("synthetic programming failure"), "根据资料回答");

        assertThrows(RuntimeException.class, scenario.runtime::run);

        assertEquals(AgentState.ERROR, scenario.runtime.state());
        assertTrue(answerMessages(scenario.saved).isEmpty());
        assertEquals(1, scenario.knowledge.calls.get());
    }

    @ParameterizedTest
    @MethodSource("terminalGuards")
    @DisplayName("检索后撤权、取消或租约失效不能落答案或进入原文回退")
    void terminalGuardFailureNeverFallsBack(Supplier<RuntimeException> failure) throws Exception {
        AtomicBoolean revoked = new AtomicBoolean();
        ChatResponse selected = sourceRound("source-after-revoke", "ret-1:1", "前置条件");
        List<ModelStep> steps = List.of(step(knowledgeRound("knowledge-1")), () -> {
            revoked.set(true);
            return selected;
        });
        Scenario scenario = scripted(envelope(), steps, () -> {
            if (revoked.get()) throw failure.get();
        }, null, "根据资料回答");

        assertThrows(RuntimeException.class, scenario.runtime::run);

        assertEquals(AgentState.ERROR, scenario.runtime.state());
        assertTrue(answerMessages(scenario.saved).isEmpty());
        assertEquals(1, scenario.knowledge.calls.get());
        assertEquals(2, scenario.runtime.modelCalls.get());
    }

    static Stream<Supplier<RuntimeException>> terminalGuards() {
        return Stream.of(
                () -> new SecurityException("synthetic access revoked"),
                () -> new RunCancelledException("synthetic cancellation"),
                () -> new RunLeaseLostException("synthetic lease lost"));
    }

    @Test
    @DisplayName("达到20步仍只检索而无答复，运行必须为ERROR")
    void stepLimitWithoutAnAnswerIsAnError() throws Exception {
        List<ModelStep> repeated = new ArrayList<>();
        for (int index = 0; index < 20; index++) {
            repeated.add(step(knowledgeRound("knowledge-" + index)));
        }
        Scenario scenario = scripted(envelope(), repeated, () -> { }, null, "根据资料回答");

        runAllowingFailure(scenario);

        assertEquals(AgentState.ERROR, scenario.runtime.state());
        assertTrue(answerMessages(scenario.saved).isEmpty());
        assertEquals(20, scenario.runtime.modelCalls.get());
        assertEquals(20, scenario.knowledge.calls.get());
    }

    @ParameterizedTest
    @ValueSource(strings = {"今天几号", "今天日期是什么？", "查询当前日期"})
    @DisplayName("只有明确的日期单问可在getDate后直接交付，不再让模型编写日期")
    void actualDateToolResultIsDeliveredWithoutAnotherModelCall(String question) throws Exception {
        Scenario scenario = scripted(envelope(), List.of(step(toolRound("date-1", "getDate", "{}"))),
                () -> { }, null, question);

        scenario.runtime.run();

        ChatMessageDTO answer = onlyAnswer(scenario);
        assertTrue(answer.getContent().contains("2026-11-11"));
        assertTrue(answer.getMetadata().getCitations() == null || answer.getMetadata().getCitations().isEmpty());
        assertEquals(1, scenario.date.calls.get());
        assertEquals(0, scenario.knowledge.calls.get());
        assertEquals(1, scenario.runtime.modelCalls.get());
        assertEquals(AgentState.FINISHED, scenario.runtime.state());
    }

    @Test
    @DisplayName("日期加知识的复合问题先查日期不能结束，还要完成检索和来源交付")
    void dateThenKnowledgeQuestionDoesNotFinishAfterTheDateTool() throws Exception {
        Scenario scenario = scripted(envelope(), List.of(
                step(toolRound("date-1", "getDate", "{}")),
                step(knowledgeRound("knowledge-1")),
                step(sourceRound("source-1", "ret-1:1", "前置条件"))),
                () -> { }, null, "今天几号，并解释TCP三次握手？");

        scenario.runtime.run();

        ChatMessageDTO answer = onlyAnswer(scenario);
        assertTrue(answer.getContent().startsWith("查询时日期：2026-11-11。"));
        assertTrue(answer.getContent().contains("只有满足前置条件时，才能执行。"));
        assertEquals(1, answer.getMetadata().getCitations().size());
        assertEquals(1, scenario.date.calls.get());
        assertEquals(1, scenario.knowledge.calls.get());
        assertEquals(3, scenario.runtime.modelCalls.get());
        assertEquals(List.of(1), scenario.retrievalCountsAtAnswer,
                "no date-only answer may be persisted before the knowledge question is handled");
    }

    @Test
    @DisplayName("天气问题先查日期后仍需检索并说明资料不足，不能只交付日期就成功")
    void weatherQuestionCannotBeCompletedByLookingUpTheDate() throws Exception {
        String noMatch = JSON.writeValueAsString(RetrievalEnvelope.noMatch("ret-1", "NO_MATCH"));
        Scenario scenario = scripted(noMatch, List.of(
                step(toolRound("date-1", "getDate", "{}")),
                step(knowledgeRound("knowledge-1")),
                step(toolRound("source-1", "sourceAnswer", "{\"insufficient\":true}"))),
                () -> { }, null, "深圳明天下雨吗？");

        scenario.runtime.run();

        ChatMessageDTO answer = onlyAnswer(scenario);
        assertEquals("查询时日期：2026-11-11。\n\n" + GroundedAnswerAssembler.INSUFFICIENT_PREFIX,
                answer.getContent());
        assertTrue(answer.getMetadata().getCitations() == null || answer.getMetadata().getCitations().isEmpty());
        assertEquals(1, scenario.date.calls.get());
        assertEquals(1, scenario.knowledge.calls.get());
        assertEquals(3, scenario.runtime.modelCalls.get());
        assertEquals(List.of(1), scenario.retrievalCountsAtAnswer);
    }

    @Test
    @DisplayName("客户端忽略线程中断仍返回合法交付时，不落答案、不执行来源回退")
    void interruptedClientResponseCannotBecomeAnAnswerOrFallback() throws Exception {
        ChatResponse validSource = sourceRound("source-1", "ret-1:1", "前置条件");
        Scenario scenario = scripted(envelope(), List.of(step(knowledgeRound("knowledge-1")), () -> {
            Thread.currentThread().interrupt();
            return validSource;
        }), () -> { }, null, "根据资料解释适用条件");

        try {
            assertThrows(RuntimeException.class, scenario.runtime::run);
            assertEquals(AgentState.ERROR, scenario.runtime.state());
            assertFalse(scenario.runtime.hasDeliveredAnswer());
            assertTrue(answerMessages(scenario.saved).isEmpty(), "neither sourceAnswer nor fallback may persist");
            assertEquals(1, scenario.knowledge.calls.get(), "interruption must not start server fallback retrieval");
            assertEquals(2, scenario.runtime.modelCalls.get(), "interruption must not start another model attempt");
            assertTrue(Thread.currentThread().isInterrupted());
        } finally {
            Thread.interrupted();
        }
    }

    private static void assertOriginalReferenceFallback(Scenario scenario) {
        ChatMessageDTO answer = onlyAnswer(scenario);
        assertTrue(answer.getContent().contains("原文"));
        assertTrue(answer.getContent().contains("参考"), "回退必须标明原文参考，而不是伪装为生成答案");
        assertTrue(answer.getContent().contains("只有满足前置条件时，才能执行。"));
        assertTrue(answer.getContent().contains("单次操作安全不代表操作组合安全"));
        assertFalse(answer.getContent().contains(UNTRUSTED));
        assertNotNull(answer.getMetadata().getCitations());
        assertFalse(answer.getMetadata().getCitations().isEmpty());
        assertEquals(AgentState.FINISHED, scenario.runtime.state());
    }

    private static void assertNoUntrustedAnswer(Scenario scenario) {
        assertTrue(answerMessages(scenario.saved).stream().noneMatch(message -> message.getContent().contains(UNTRUSTED)));
    }

    private static void runAllowingFailure(Scenario scenario) {
        try {
            scenario.runtime.run();
        } catch (RuntimeException expectedTerminalFailure) {
            // 这里测试的是终态与副作用，run可选择抛出固定失败或显式返回ERROR。
            // 脚本耗尽产生AssertionError，不会被这里吞掉。
        }
    }

    private static ChatMessageDTO onlyAnswer(Scenario scenario) {
        List<ChatMessageDTO> answers = answerMessages(scenario.saved);
        assertEquals(1, answers.size(), "一个运行只能持久化一个面向用户的最终答复");
        return answers.getFirst();
    }

    private static List<ChatMessageDTO> answerMessages(List<ChatMessageDTO> saved) {
        return saved.stream().filter(message -> message.getRole() == ChatMessageDTO.RoleType.ASSISTANT
                && message.getContent() != null && !message.getContent().isBlank()).toList();
    }

    private static Scenario scenario(String envelope, ChatResponse... responses) {
        return scripted(envelope, Arrays.stream(responses).map(JChatMindSourceAnswerTest::step).toList(),
                () -> { }, null, "请根据资料说明适用条件");
    }

    private static Scenario scripted(String envelope, List<ModelStep> script, Runnable guard,
                                     RuntimeException failureAfterScript, String question) {
        List<ChatMessageDTO> saved = new ArrayList<>();
        List<Integer> retrievalCountsAtAnswer = new ArrayList<>();
        SyntheticKnowledgeTool knowledge = new SyntheticKnowledgeTool(envelope);
        SyntheticSideEffectTool sideEffect = new SyntheticSideEffectTool();
        SyntheticDateTool date = new SyntheticDateTool();
        ChatMessageFacadeService messages = mock(ChatMessageFacadeService.class);
        when(messages.createChatMessage(any(ChatMessageDTO.class))).thenAnswer(invocation -> {
            ChatMessageDTO dto = invocation.getArgument(0);
            saved.add(dto);
            if (!answerMessages(List.of(dto)).isEmpty()) retrievalCountsAtAnswer.add(knowledge.calls.get());
            return CreateChatMessageResponse.builder().chatMessageId("message-" + saved.size()).build();
        });
        ToolCallback[] callbacks = MethodToolCallbackProvider.builder().toolObjects(
                knowledge, new SourceAnswerTool(), new DirectAnswerTool(), new GroundedAnswerTool(),
                new TerminateTool(), sideEffect, date).build().getToolCallbacks();
        ScriptedRuntime runtime = new ScriptedRuntime(script, callbacks, messages, guard, failureAfterScript, question);
        ReflectionTestUtils.setField(runtime, "chatOptions", DefaultToolCallingChatOptions.builder()
                .internalToolExecutionEnabled(false).toolCallbacks(callbacks).build());
        return new Scenario(runtime, saved, knowledge, sideEffect, date, retrievalCountsAtAnswer);
    }

    private record Scenario(ScriptedRuntime runtime, List<ChatMessageDTO> saved, SyntheticKnowledgeTool knowledge,
                            SyntheticSideEffectTool sideEffect, SyntheticDateTool date,
                            List<Integer> retrievalCountsAtAnswer) {
    }

    @FunctionalInterface
    private interface ModelStep {
        ChatResponse next();
    }

    private static ModelStep step(ChatResponse response) {
        return () -> response;
    }

    private static final class ScriptedRuntime extends JChatMind {
        private final Queue<ModelStep> steps;
        private final RuntimeException failureAfterScript;
        final AtomicInteger modelCalls = new AtomicInteger();

        ScriptedRuntime(List<ModelStep> script, ToolCallback[] tools, ChatMessageFacadeService messages,
                        Runnable guard, RuntimeException failureAfterScript, String question) {
            super("agent", "资料助手", "测试公开资料交付", "只根据本次检索回答", mock(ChatClient.class),
                    30, List.of(), List.of(tools),
                    List.of(KnowledgeBaseDTO.builder().id(KB).name("合成知识库").build()), "session",
                    mock(SseService.class), messages, new ChatMessageConverter(JSON), guard, question);
            this.steps = new ConcurrentLinkedQueue<>(script);
            this.failureAfterScript = failureAfterScript;
        }

        @Override
        ChatResponse requestModel(Prompt prompt, String thinkPrompt) {
            modelCalls.incrementAndGet();
            ModelStep next = steps.poll();
            if (next == null && failureAfterScript != null) throw failureAfterScript;
            assertNotNull(next, "运行请求了脚本范围外的模型调用，可能超过了修正/步骤预算");
            return next.next();
        }
    }

    private static String envelope() throws Exception {
        return JSON.writeValueAsString(RetrievalEnvelope.ok("ret-1", List.of(hit("ret-1:1", "chunk-a", SOURCE, 1, 3, 5))));
    }

    private static RetrievalHit hit(String id, String chunk, String text, int rank, int start, int end) {
        return new RetrievalHit(id, chunk, KB, rank, text,
                new SourceLocation(DOC, "合成资料", List.of("条件与例外"), "hash-" + chunk, start, end),
                "body-v1", "revision-1", RetrievalHit.METRIC_L2, 0.5);
    }

    private static ChatResponse knowledgeRound(String id) {
        return response("", List.of(knowledgeCall(id)));
    }

    private static AssistantMessage.ToolCall knowledgeCall(String id) {
        return new AssistantMessage.ToolCall(id, "function", "KnowledgeTool",
                "{\"kbsId\":\"" + KB + "\",\"query\":\"适用条件\"}");
    }

    private static ChatResponse sourceRound(String id, String citationId, String anchor) throws Exception {
        return response("", List.of(sourceCall(id, citationId, anchor)));
    }

    private static AssistantMessage.ToolCall sourceCall(String id, String citationId, String anchor) throws Exception {
        var parameters = JSON.createObjectNode();
        parameters.putArray("sources").addObject().put("citationId", citationId).put("evidenceQuote", anchor);
        return new AssistantMessage.ToolCall(id, "function", "sourceAnswer", JSON.writeValueAsString(parameters));
    }

    private static ChatResponse toolRound(String id, String name, String arguments) {
        return response("", List.of(new AssistantMessage.ToolCall(id, "function", name, arguments)));
    }

    private static ChatResponse response(String text, List<AssistantMessage.ToolCall> calls) {
        return new ChatResponse(List.of(new Generation(AssistantMessage.builder().content(text).toolCalls(calls).build())));
    }

    public static final class SyntheticKnowledgeTool {
        private final String envelope;
        final Queue<String> laterEnvelopes = new ConcurrentLinkedQueue<>();
        final AtomicInteger calls = new AtomicInteger();

        SyntheticKnowledgeTool(String envelope) {
            this.envelope = envelope;
        }

        @Tool(name = "KnowledgeTool", description = "合成知识检索")
        public String knowledgeQuery(String kbsId, String query) {
            int count = calls.incrementAndGet();
            String next = count > 1 ? laterEnvelopes.poll() : null;
            return next == null ? envelope : next;
        }
    }

    public static final class SyntheticSideEffectTool {
        final AtomicInteger calls = new AtomicInteger();

        @Tool(name = "dangerousWrite", description = "测试用副作用，公开知识模式不得执行")
        public String dangerousWrite() {
            calls.incrementAndGet();
            return "不应该被执行";
        }
    }

    public static final class SyntheticDateTool {
        final AtomicInteger calls = new AtomicInteger();

        @Tool(name = "getDate", description = "合成日期结果")
        public String getDate() {
            calls.incrementAndGet();
            return "2026-11-11";
        }
    }
}

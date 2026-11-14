package com.kama.jchatmind.agent;

import com.kama.jchatmind.citation.CitationRegistry;
import com.kama.jchatmind.citation.AnswerCitation;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Predicate;

/**
 * 「陈述 + citationId + 原文短引」的装配器（新交付协议 grounded-v1）。
 *
 * <p>模型只交付陈述、它实际用到的来源 ID 与一段原文短引；**编号、排序、去重与来源卡片全部由服务端生成**，
 * 模型不再维护「[n] 对应第几项」的映射。规则：</p>
 * <ul>
 *   <li>citationId 必须是本轮真实登记过的检索命中，否则整轮判无效；</li>
 *   <li>原文短引必须出现在**该次命中自身的完整片段**里（空白归一后按包含判断），
 *       不能拿同文档别章的一句顶上；</li>
 *   <li>同一来源在多次陈述里复用同一个编号；编号由 {@link CitationRegistry#resolve} 按服务端顺序给出；</li>
 *   <li>资料不足走独立结果：只输出「本次可用资料不足以确认」加一句原因，不挂任何引用。</li>
 * </ul>
 *
 * <p>说明：短引存在只证明「引文确实来自该片段」，**不证明引文蕴含陈述**；语义支持仍由人工复核。</p>
 */
final class GroundedAnswerAssembler {

    static final String PROTOCOL_VERSION = "grounded-v1";
    static final String EXTRACTIVE_PROTOCOL_VERSION = "grounded-extractive-v2";
    static final String INSUFFICIENT_PREFIX = "本次可用资料不足以确认。";
    static final String EXTRACTIVE_PREFIX = "以下为本轮检索到的资料原文：";
    static final String PARTIAL_PREFIX = "本次资料只能支持问题的一部分，未覆盖的内容无法确认。";
    static final int MAX_EXTRACTIVE_SOURCES = 3;

    /** 模型交付的一条陈述：一句话 + 一个来源 ID + 一段原文短引。 */
    record Statement(String text, String citationId, String evidenceQuote) {
    }

    /** 装配结果：正文、来源卡片、校验通知、是否属于资料不足。 */
    record Assembled(String body, List<AnswerCitation> citations, List<CitationRegistry.Notice> notices,
                     boolean insufficient) {
    }

    private GroundedAnswerAssembler() {
    }

    /**
     * 确定性的资料原文交付。模型只选择来源与原文锚点，服务端显示该来源的完整片段。
     *
     * <p>与 {@link #assemble} 不同，本方法绝不把模型的 {@code text} 当成可验证结论。
     * 即使模型删去否定、适用条件或把另一段的事实配到这个 ID，输出仍来自本轮登记的完整原文；
     * 短引仅核对选择的是哪一个片段，不声称它能证明任意改写。片段是否完整回答了用户的问题，
     * 仍是检索与选择的能力边界，因此正文明确标为「资料原文」。</p>
     *
     * <p>资料不足分支只接受 statements 缺省（null），并只返回固定服务端文案。
     * 任意模型 reason 都不进入用户正文，避免以资料不足为名附带无法核对的结论。</p>
     */
    static Assembled assembleExtractive(List<Statement> statements, String insufficient, CitationRegistry registry,
                                        Predicate<String> isSourceAuthorized) {
        return assembleExtractive(statements, insufficient, registry, isSourceAuthorized, false);
    }

    static Assembled assembleExtractive(List<Statement> statements, String insufficient, CitationRegistry registry,
                                        Predicate<String> isSourceAuthorized, boolean partial) {
        if (insufficient != null && !insufficient.isBlank()) {
            if (statements != null || partial) {
                throw new InvalidAnswerFormatException("Evidence answer must choose sources or insufficient, not both");
            }
            return new Assembled(INSUFFICIENT_PREFIX, List.of(), List.of(), true);
        }
        if (statements == null || statements.isEmpty()) {
            throw new InvalidAnswerFormatException("Evidence answer must select at least one retrieved source");
        }
        // 限制输入条数，而不只限制去重后的数量；重复同一个 ID 也不能绕过成本上限。
        if (statements.size() > MAX_EXTRACTIVE_SOURCES) {
            throw new InvalidAnswerFormatException("Evidence answer may select at most three sources");
        }
        if (registry == null || isSourceAuthorized == null) {
            throw new InvalidAnswerFormatException("Evidence answer requires a current authorized source registry");
        }

        List<String> orderedIds = new ArrayList<>();
        for (Statement statement : statements) {
            if (statement == null || registered(registry, statement.citationId()) == null) {
                throw new InvalidAnswerFormatException("Model answer references a source that could not be verified");
            }
            if (!orderedIds.contains(statement.citationId())) {
                orderedIds.add(statement.citationId());
            }
        }

        CitationRegistry.Resolution resolution = registry.resolve(orderedIds, isSourceAuthorized);
        // 授权先于短引检查和正文渲染。来源被撤销时，不能留下任何部分答案。
        for (int position = 1; position <= orderedIds.size(); position++) {
            if (!resolution.labelsByRequestIndex().containsKey(position)) {
                throw new InvalidAnswerFormatException("Model answer references a source that could not be verified");
            }
        }
        if (resolution.citations().isEmpty() || resolution.citations().size() > MAX_EXTRACTIVE_SOURCES) {
            throw new InvalidAnswerFormatException("Model answer references a source that could not be verified");
        }
        for (Statement statement : statements) {
            CitationRegistry.RegisteredCitation source = registered(registry, statement.citationId());
            String anchor = normalize(statement.evidenceQuote());
            if (anchor.isEmpty() || !normalize(source.content()).contains(anchor)) {
                throw new InvalidAnswerFormatException("Model answer quotes text that is not in the retrieved source");
            }
        }

        StringBuilder body = new StringBuilder(partial ? PARTIAL_PREFIX + "\n\n" + EXTRACTIVE_PREFIX : EXTRACTIVE_PREFIX);
        // resolve 产生的卡片已经按服务端来源顺序编号、按同一来源范围去重。
        // 正文与卡片读取同一个 ID，不通过模型维护的数组位置重建映射。
        for (AnswerCitation citation : resolution.citations()) {
            CitationRegistry.RegisteredCitation source = registered(registry, citation.citationId());
            String heading = String.join(" › ", source.source().headingPath());
            if (heading.isBlank()) {
                heading = source.source().documentName();
            }
            body.append("\n\n**资料原文 [").append(citation.label()).append(']');
            if (heading != null && !heading.isBlank()) {
                body.append(" · ").append(GroundedSourceRenderer.heading(heading));
            }
            body.append("**\n\n").append(GroundedSourceRenderer.quote(source.content()));
        }
        return new Assembled(body.toString(), resolution.citations(), resolution.notices(), false);
    }

    static Assembled assemble(List<Statement> statements, String insufficient, CitationRegistry registry,
                              Predicate<String> isSourceAuthorized) {
        if (insufficient != null && !insufficient.isBlank()) {
            return new Assembled(INSUFFICIENT_PREFIX + " " + insufficient.strip(), List.of(), List.of(), true);
        }
        if (statements == null || statements.isEmpty()) {
            throw new InvalidAnswerFormatException("Model answer must contain at least one statement");
        }

        List<String> orderedIds = new ArrayList<>();
        for (Statement statement : statements) {
            if (statement == null || statement.text() == null || statement.text().isBlank()) {
                throw new InvalidAnswerFormatException("Model answer contains an empty statement");
            }
            CitationRegistry.RegisteredCitation registered = registered(registry, statement.citationId());
            if (registered == null) {
                throw new InvalidAnswerFormatException("Model answer references a source that could not be verified");
            }
            String quote = normalize(statement.evidenceQuote());
            if (quote.isEmpty() || !normalize(registered.content()).contains(quote)) {
                throw new InvalidAnswerFormatException("Model answer quotes text that is not in the retrieved source");
            }
            if (!orderedIds.contains(statement.citationId())) {
                orderedIds.add(statement.citationId());
            }
        }

        CitationRegistry.Resolution resolution = registry.resolve(orderedIds, isSourceAuthorized);
        // 逐个位置检查映射是否成立：不同检索 id 可以指向同一来源，登记器会把它们合并成一个展示引用
        // （{1→1, 2→1}），这是正常去重，不是来源无效。缺失位置才判无效。
        Map<Integer, Integer> labelsByPosition = resolution.labelsByRequestIndex();
        for (int position = 1; position <= orderedIds.size(); position++) {
            if (!labelsByPosition.containsKey(position)) {
                throw new InvalidAnswerFormatException("Model answer references a source that could not be verified");
            }
        }
        if (orderedIds.isEmpty() || resolution.citations().isEmpty()) {
            throw new InvalidAnswerFormatException("Model answer references a source that could not be verified");
        }
        Map<String, Integer> numberByCitationId = new LinkedHashMap<>();
        for (int position = 1; position <= orderedIds.size(); position++) {
            numberByCitationId.put(orderedIds.get(position - 1), labelsByPosition.get(position));
        }

        StringBuilder body = new StringBuilder();
        for (Statement statement : statements) {
            Integer number = numberByCitationId.get(statement.citationId());
            if (number == null) {
                throw new InvalidAnswerFormatException("Model answer references a source that could not be verified");
            }
            if (body.length() > 0) {
                body.append("\n\n");
            }
            body.append(statement.text().strip()).append(" [").append(number).append(']');
        }
        return new Assembled(body.toString(), resolution.citations(), resolution.notices(), false);
    }

    private static CitationRegistry.RegisteredCitation registered(CitationRegistry registry, String citationId) {
        if (citationId == null || citationId.isBlank()) {
            return null;
        }
        for (CitationRegistry.RegisteredCitation candidate : registry.registered()) {
            if (citationId.equals(candidate.citationId())) {
                return candidate;
            }
        }
        return null;
    }

    /** 空白归一：片段里有换行、短引常写成一行，所以比较前都去掉空白。 */
    private static String normalize(String text) {
        return text == null ? "" : text.replaceAll("\\s+", "").strip();
    }
}

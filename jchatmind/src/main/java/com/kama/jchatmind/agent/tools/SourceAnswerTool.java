package com.kama.jchatmind.agent.tools;

import org.springframework.ai.tool.annotation.ToolParam;

import java.util.List;

/**
 * 公开知识问答的资料原文交付工具。
 *
 * <p>不注册为组件，仅由公开执行器显式装配，避免改变账号工具及 grounded-v1 的语义。
 * 模型只选择本轮来源和连续原文锚点，正文与编号均由服务端产生，参数中没有自由生成的答复字段。</p>
 */
public final class SourceAnswerTool implements Tool {

    public enum Coverage { full, partial }

    public record SourceSelection(
            @ToolParam(description = "本轮KnowledgeTool返回的完整citationId，原样复制") String citationId,
            @ToolParam(description = "该citationId对应片段内的一段连续原文，只作选择锚点，不改写或拼接") String evidenceQuote) {
    }

    @org.springframework.ai.tool.annotation.Tool(
            name = "sourceAnswer",
            description = "用本轮检索资料回答：选择最多三个与问题直接相关的citationId及各自片段内的连续原文锚点。"
                    + "服务端展示这些命中片段的完整原文及来源编号，保留否定、条件和例外；不要生成总结或自编[n]。"
                    + "来源仅能支持部分子问题、版本或数据时传coverage:partial，服务器明确提示未覆盖部分；"
                    + "全部所问内容都有依据时可省略coverage或传full，coverage不是语义正确性的证明。"
                    + "资料不能确认问题时只传insufficient:true，并省略sources和coverage；两种方式不能同时使用。"
                    + "不要填写answer、text、reason等字段。"
    )
    public String sourceAnswer(
            @ToolParam(required = false, description = "一到三项本轮真实来源；资料不足时省略，不传空数组") List<SourceSelection> sources,
            @ToolParam(required = false, description = "仅资料不足时传布尔true；省略sources和coverage，服务器显示固定说明") Boolean insufficient,
            @ToolParam(required = false, description = "sources覆盖范围：full或partial；省略等于full。仅覆盖部分子问题/版本/数据时选partial") Coverage coverage) {
        // 实际校验、完整原文装配与落库由运行时在执行本工具前完成。
        return "资料原文已交付";
    }

    @Override
    public String getName() {
        return "sourceAnswer";
    }

    @Override
    public String getDescription() {
        return "选择本轮检索来源，服务端交付完整资料原文与编号";
    }

    @Override
    public ToolType getType() {
        return ToolType.FIXED;
    }
}

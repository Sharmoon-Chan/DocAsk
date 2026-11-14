package com.kama.jchatmind.agent;

import java.util.regex.Matcher;

/** 将完整检索片段渲染为明确的来源引用块，不让片段里的标记冒充回答的来源编号。 */
final class GroundedSourceRenderer {

    private GroundedSourceRenderer() {
    }

    static String quote(String content) {
        String original = content.replace("\r\n", "\n").replace('\r', '\n').strip();
        boolean[] code = MarkdownRegions.codeCharacters(original);
        boolean[] escapeCitation = new boolean[original.length()];
        Matcher markers = CitationMarkers.PATTERN.matcher(original);
        while (markers.find()) {
            int start = markers.start();
            // 即使是 [1](url) 或 [1]: url 也要保护，避免原文链接定义影响服务端的 [1]。
            // 代码内的编号仍保留原样，由 Markdown 代码语义与既有格式守卫保护。
            escapeCitation[start] = !code[start] && !MarkdownRegions.escaped(original, start);
        }

        StringBuilder safe = new StringBuilder(original.length());
        for (int index = 0; index < original.length(); index++) {
            char character = original.charAt(index);
            if (escapeCitation[index]) {
                safe.append('\\');
            }
            if (!code[index] && character == '&') {
                safe.append("&amp;");
            } else if (!code[index] && character == '<') {
                safe.append("&lt;");
            } else if (!code[index] && character == '>') {
                safe.append("&gt;");
            } else {
                safe.append(character);
            }
        }
        // 引用块的边界也隔离原文中没有闭合的代码围栏，不让它吞掉下一条服务端来源标题。
        return "> " + safe.toString().replace("\n", "\n> ");
    }

    static String heading(String text) {
        StringBuilder safe = new StringBuilder();
        for (char character : text.toCharArray()) {
            if (character == '\r' || character == '\n') {
                safe.append(' ');
            } else if (character == '&') {
                safe.append("&amp;");
            } else if (character == '<') {
                safe.append("&lt;");
            } else if (character == '>') {
                safe.append("&gt;");
            } else {
                if ("\\`*_{}[]()#!|".indexOf(character) >= 0) {
                    safe.append('\\');
                }
                safe.append(character);
            }
        }
        return safe.toString();
    }
}

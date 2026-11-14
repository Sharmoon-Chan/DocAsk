package com.kama.jchatmind.agent;

import java.util.List;
import java.util.regex.Pattern;

/**
 * Conservative omission check for an explicitly requested cross-resource guarantee.
 *
 * <p>Separate facts about individual mechanisms cannot establish their combined scope. For a FULL
 * delivery, the selected original bodies must at least mention a cross-resource boundary. Missing
 * all such scope terms is an explainable reason to request evidence or PARTIAL delivery. Finding a
 * term is only a necessary vocabulary check, never proof of relevance, entailment or completeness.</p>
 *
 * <p>The caller supplies only original bodies of citations which have already passed current-run
 * identity, quote and authorization checks. Unselected adjacent text, headings and model narration
 * are not evidence for this guard. No product, provider, corpus question or answer is special-cased.</p>
 */
final class CrossResourceCoverageGuard {
    private static final Pattern CROSS_SCOPE = Pattern.compile(
            "跨\\s*(?:系统|服务|资源|数据库)"
                    + "|外部\\s*(?:数据库|系统|服务|接口|HTTP\\s*服务)"
                    + "|远(?:端|程)\\s*(?:接口|服务)"
                    + "|\\bcross[-\\s]*(?:systems?|services?|resources?|databases?)\\b"
                    + "|\\b(?:external|remote)\\s+(?:databases?|systems?|services?|interfaces?|apis?)\\b",
            Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CASE);
    private static final Pattern GUARANTEE = Pattern.compile(
            "原子|事务|回滚|一致|提交|保证|撤销|\\b(?:atomic(?:ity)?|transactions?|rollback|roll\\s+back"
                    + "|consisten(?:t|cy)|commit(?:s|ted)?|guarantee(?:s|d)?)\\b",
            Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CASE);

    private CrossResourceCoverageGuard() { }

    static void verifyFullCoverage(String originalQuestion, List<String> selectedOriginalBodies) {
        if (originalQuestion == null || !CROSS_SCOPE.matcher(originalQuestion).find()
                || !GUARANTEE.matcher(originalQuestion).find()) return;
        if (selectedOriginalBodies != null && selectedOriginalBodies.stream()
                .anyMatch(body -> body != null && CROSS_SCOPE.matcher(body).find())) return;
        throw new InvalidAnswerFormatException(
                "Full cross-resource delivery needs selected original scope evidence; retrieve it or use partial coverage");
    }
}

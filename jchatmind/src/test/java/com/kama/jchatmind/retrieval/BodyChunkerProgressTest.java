package com.kama.jchatmind.retrieval;

import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.io.InputStream;
import java.time.Duration;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

/** A one-atom budget window must make progress even when an overlap cannot include new text. */
class BodyChunkerProgressTest {
    private static final BodyChunker CHUNKER = new BodyChunker();
    private static final ChunkBudget BUDGET = ChunkBudget.DEFAULT;
    private static final String DOCUMENT = "11111111-1111-4111-8111-111111111111";

    @Test
    void twoIndividuallyFittingParagraphsWhichCannotFitTogetherTerminateWithoutLosingEither() {
        String first = "甲".repeat(500);
        String second = "乙".repeat(500);
        assertTrue(BUDGET.fits(first));
        assertTrue(BUDGET.fits(second));
        assertFalse(BUDGET.fits(first + "\n\n" + second));
        SourceDocument document = document(first + "\n\n" + second);
        List<ChunkDraft> chunks = boundedChunk(document);
        assertEquals(List.of(first, second), chunks.stream().map(ChunkDraft::content).toList());
        assertBudgetIdentityAndCoverage(document, chunks);
    }

    @Test
    void aNearlyFullParagraphFollowedByASmallParagraphStillReachesTheTail() {
        String first = "界".repeat(630);
        String tail = "TAIL-FACT " + "尾".repeat(32);
        assertFalse(BUDGET.fits(first + "\n\n" + tail));
        SourceDocument document = document("# Near capacity\n\n" + first + "\n\n" + tail);
        List<ChunkDraft> chunks = boundedChunk(document);
        assertTrue(chunks.stream().anyMatch(chunk -> chunk.content().contains("TAIL-FACT")));
        assertBudgetIdentityAndCoverage(document, chunks);
    }

    @Test
    void anOverlappingLargeTailAtomCannotFreezeTheNextWindow() {
        String prefix = "首".repeat(80);
        String overlapping = "中".repeat(520);
        String tail = "尾".repeat(500) + " TAIL-FACT";
        assertTrue(BUDGET.fits(prefix + "\n\n" + overlapping));
        assertFalse(BUDGET.fits(overlapping + "\n\n" + tail));
        SourceDocument document = document(prefix + "\n\n" + overlapping + "\n\n" + tail);
        List<ChunkDraft> chunks = boundedChunk(document);
        assertTrue(chunks.stream().anyMatch(chunk -> chunk.content().contains("TAIL-FACT")));
        assertTrue(chunks.size() <= 3, "overlap must not produce unbounded repeated ranges");
        assertBudgetIdentityAndCoverage(document, chunks);
    }

    @Test
    void anOversizedSingleLineSplitIntoFullWindowsCannotFreezeThePacker() {
        SourceDocument document = document("# Large inline source\n\n`" + "字".repeat(1_800) + "`\n\nTAIL-FACT");
        List<ChunkDraft> chunks = boundedChunk(document);
        assertTrue(chunks.size() >= 3);
        assertTrue(chunks.stream().anyMatch(chunk -> chunk.content().contains("TAIL-FACT")));
        assertBudgetIdentityAndCoverage(document, chunks);
    }

    @Test
    void theUnchangedV9ReleaseDocumentWhichExhaustedTheHeapChunksWithinBudget() throws IOException {
        byte[] raw;
        try (InputStream fixture = BodyChunkerProgressTest.class.getClassLoader()
                .getResourceAsStream("retrieval-boundary/v9-contribution-map.md")) {
            assertNotNull(fixture);
            raw = fixture.readAllBytes();
        }
        SourceDocument document = new SourceDocument(DOCUMENT, "v9-contribution-map.md", SourceText.normalize(raw));
        assertEquals("04ea597bfb2b261d2016aa896e70b240351b4f2d8ec96ee8c44224342074c94d", document.sourceHash(),
                "retain the exact normalized release text instead of shortening it to avoid the bug");
        List<ChunkDraft> chunks = boundedChunk(document);
        assertTrue(!chunks.isEmpty() && chunks.size() < 100);
        assertBudgetIdentityAndCoverage(document, chunks);
    }

    private static SourceDocument document(String text) {
        return new SourceDocument(DOCUMENT, "progress.md", SourceText.normalize(text));
    }

    private static List<ChunkDraft> boundedChunk(SourceDocument document) {
        return assertTimeoutPreemptively(Duration.ofSeconds(2), () -> CHUNKER.chunk(document, BUDGET),
                "single-atom windows and overlap must advance, not append forever");
    }

    private static void assertBudgetIdentityAndCoverage(SourceDocument document, List<ChunkDraft> chunks) {
        String[] lines = document.source().text().split("\n", -1);
        for (int index = 0; index < chunks.size(); index++) {
            ChunkDraft chunk = chunks.get(index);
            assertEquals(index, chunk.ordinal());
            assertEquals(document.sourceHash(), chunk.sourceHash());
            assertTrue(BUDGET.fits(chunk.content()));
            assertTrue(chunk.startLine() >= 1 && chunk.endLine() >= chunk.startLine()
                    && chunk.endLine() <= document.source().lineCount());
            String span = String.join("\n", java.util.Arrays.copyOfRange(lines, chunk.startLine() - 1, chunk.endLine()));
            assertTrue(span.contains(chunk.content()), "source line range must contain the actual original text");
        }
        String text = document.source().text();
        boolean[] covered = new boolean[text.length()];
        for (BodyChunker.Segment segment : CHUNKER.segments(BodyChunker.newParser().parse(text), document.source())) {
            List<BodyChunker.Range> ranges = CHUNKER.pack(segment, document.source(), BUDGET);
            assertTrue(ranges.size() <= text.length(), "range count must remain finite relative to source size");
            int previousStart = -1;
            for (BodyChunker.Range range : ranges) {
                assertTrue(range.startChar() > previousStart, "each window start must strictly advance");
                previousStart = range.startChar();
                for (int offset = range.startChar(); offset < range.endChar(); offset++) covered[offset] = true;
            }
            for (int offset = segment.startOffset(); offset < segment.endOffset(); offset++) {
                if (!Character.isWhitespace(text.charAt(offset))) {
                    assertTrue(covered[offset], "non-heading source character was lost at offset " + offset);
                }
            }
        }
    }
}

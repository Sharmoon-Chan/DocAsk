package com.kama.jchatmind.runs;

import com.kama.jchatmind.execution.RunRepository;
import com.kama.jchatmind.model.dto.ChatMessageDTO;
import com.kama.jchatmind.service.ChatMessageFacadeService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.Optional;

/**
 * 运行态守卫的落库边界（任务 07 / 验收缺陷 F01）。
 *
 * <p>只给终态写回加 fencing 还不够：被判定为 {@code INTERRUPTED} 之后，普通消息 INSERT 依然能成功，
 * 于是数据库会同时声称「运行已中断」和「之后写入了最终答案」。这里把
 * 「校验运行仍是 RUNNING 且 fencing 未变 → 写消息 → 写 answer_message_id」放进同一个短事务：</p>
 *
 * <ul>
 *   <li>先 {@code SELECT ... FOR UPDATE} 锁任务行，终态事务与本次写入因此互斥；</li>
 *   <li>状态不是 {@code RUNNING} 或 fencing 不匹配时抛 {@link RunLeaseLostException}，
 *       事务回滚，消息与答案关联一个都不会留下；</li>
 *   <li>模型/工具调用仍然在事务之外，事务只覆盖一次 INSERT（必要时再加一次 UPDATE）。</li>
 * </ul>
 */
@Service
public class RunResultWriter {

    private static final Logger log = LoggerFactory.getLogger(RunResultWriter.class);

    private final RunQueueRepository jobs;
    private final RunRepository runs;
    private final ChatMessageFacadeService messages;
    private final JdbcTemplate jdbc;

    public RunResultWriter(RunQueueRepository jobs, RunRepository runs, ChatMessageFacadeService messages,
                           JdbcTemplate jdbc) {
        this.jobs = jobs;
        this.runs = runs;
        this.messages = messages;
        this.jdbc = jdbc;
    }

    /**
     * 带运行态校验的消息落库。
     *
     * @param finalAnswer true 时同一个事务里还会写 {@code answer_message_id}，运行已终态则整笔回滚
     * @throws RunLeaseLostException 运行已进入终态、任务已被标记中断或 fencing 已被接管
     */
    @Transactional
    public String persistMessage(String jobId, long fencingToken, String runId, ChatMessageDTO message,
                                 boolean finalAnswer) {
        RunQueueJob job = requireOwnedRunning(jobId, fencingToken, runId);
        requireWritableLease(job);
        String messageId = messages.createChatMessage(message).getChatMessageId();
        if (finalAnswer) {
            if (runs.setAnswerMessageIdIfRunning(runId, messageId) == 0) {
                log.warn("Late final answer rejected: run is no longer RUNNING: run={}", runId);
                throw new RunLeaseLostException("运行已进入终态，拒绝写入迟到的最终答复");
            }
        }
        // Message insertion / answer association can wait on other rows after the task lock was acquired.
        // The task row stays locked, so cancellation cannot change, but its lease can expire in wall time.
        // Recheck before returning: an expired write rolls back both the message and the answer association.
        requireWritableLease(job);
        return messageId;
    }

    private RunQueueJob requireOwnedRunning(String jobId, long fencingToken, String runId) {
        Optional<RunQueueJob> locked = jobs.lockById(jobId);
        if (locked.isEmpty() || locked.get().fencingToken() != fencingToken
                || locked.get().status() != RunQueueStatus.RUNNING) {
            log.warn("Late message rejected: run terminal or lease taken over: run={}", runId);
            throw new RunLeaseLostException("运行已进入终态或租约已被接管，拒绝写入迟到结果");
        }
        return locked.get();
    }

    private void requireWritableLease(RunQueueJob job) {
        if (job.cancelRequested()) {
            throw new RunCancelledException("本次运行已收到取消请求，拒绝写入迟到结果");
        }
        // NOW() is the transaction start time in PostgreSQL; it does not advance while waiting for locks.
        Timestamp current = jdbc.queryForObject("SELECT clock_timestamp()", Timestamp.class);
        Instant databaseNow = current == null ? null : current.toInstant();
        if (databaseNow == null || job.leaseExpiresAt() == null || !job.leaseExpiresAt().isAfter(databaseNow)) {
            throw new RunLeaseLostException("租约已过期，拒绝写入迟到结果");
        }
    }
}

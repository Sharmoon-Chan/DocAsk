package com.kama.jchatmind.models.net;

import java.net.InetAddress;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.function.Predicate;

/**
 * 把一次 DNS 解析得到的多个地址重排成「能连的排前面」。
 *
 * <p>为什么需要：中转站背后是多条边缘线路，一次解析会返回多个地址，其中混着从本机不可达的。
 * 连接器通常只用列表里的第一个地址，撞上坏的就一直等到连接超时——实测这类超时会把一次模型调用
 * 从 3 秒拖到 30 秒。这里在解析阶段就并发探测每个地址，把可达的按握手耗时升序排前面，
 * 不可达的保留在末尾当兜底，而不是从列表里删掉。</p>
 *
 * <p>探测是并行的、总预算有上限；探测结果短暂缓存，避免每次连接都重新探测。任一环节出错都退回原始顺序，
 * 让调用方拿到和没有这个功能时相同的结果。</p>
 */
public class AddressFailoverSelector {

    /** 单个地址的探测结果；失败时 latencyNanos 为 {@link Long#MAX_VALUE}。 */
    public record Probe(InetAddress address, boolean reachable, long latencyNanos) {}

    private final Predicate<InetAddress> prober;
    private final long probeTimeoutMs;
    private final long cacheTtlMs;
    private final Map<String, CachedOrder> cache = new LinkedHashMap<>();
    private static final ExecutorService PROBES = Executors.newCachedThreadPool(runnable -> {
        Thread thread = new Thread(runnable, "address-probe");
        thread.setDaemon(true);
        return thread;
    });

    public AddressFailoverSelector(Predicate<InetAddress> prober, long probeTimeoutMs, long cacheTtlMs) {
        this.prober = prober;
        this.probeTimeoutMs = Math.max(1L, probeTimeoutMs);
        this.cacheTtlMs = Math.max(0L, cacheTtlMs);
    }

    private record CachedOrder(long expiresAtNanos, List<InetAddress> addresses) {}

    /**
     * @param host     解析使用的主机名，仅用于缓存键
     * @param resolved 原始解析结果
     * @return 可达地址在前（按耗时升序），不可达地址按原顺序排在后面；结果非空且与输入等长
     */
    public List<InetAddress> reorder(String host, List<InetAddress> resolved) {
        if (resolved == null || resolved.size() <= 1) {
            return resolved == null ? List.of() : resolved;
        }
        long now = System.nanoTime();
        CachedOrder cached = cache.get(host);
        if (cached != null && cached.expiresAtNanos() > now && cached.addresses().size() == resolved.size()) {
            return cached.addresses();
        }
        List<InetAddress> ordered = probeAll(resolved);
        if (cacheTtlMs > 0) {
            cache.put(host, new CachedOrder(now + TimeUnit.MILLISECONDS.toNanos(cacheTtlMs), ordered));
        }
        return ordered;
    }

    private List<InetAddress> probeAll(List<InetAddress> resolved) {
        List<CompletableFuture<Probe>> futures = new ArrayList<>(resolved.size());
        for (InetAddress address : resolved) {
            futures.add(CompletableFuture.supplyAsync(() -> probe(address), PROBES));
        }
        List<Probe> probes = new ArrayList<>(resolved.size());
        for (CompletableFuture<Probe> future : futures) {
            try {
                probes.add(future.get(probeTimeoutMs + 50L, TimeUnit.MILLISECONDS));
            } catch (Exception timeoutOrFailure) {
                // 单个探测超时不影响其它地址，也不让整次解析失败。
                probes.add(new Probe(null, false, Long.MAX_VALUE));
            }
        }
        List<InetAddress> reachable = new ArrayList<>();
        List<Long> reachableLatency = new ArrayList<>();
        List<InetAddress> unreachable = new ArrayList<>();
        for (int index = 0; index < probes.size(); index++) {
            Probe probe = probes.get(index);
            InetAddress address = probe.address() != null ? probe.address() : resolved.get(index);
            if (probe.reachable()) {
                insertByLatency(reachable, reachableLatency, address, probe.latencyNanos());
            } else {
                unreachable.add(address);
            }
        }
        List<InetAddress> ordered = new ArrayList<>(resolved.size());
        ordered.addAll(reachable);
        ordered.addAll(unreachable);
        return ordered.size() == resolved.size() ? ordered : resolved;
    }

    private Probe probe(InetAddress address) {
        long started = System.nanoTime();
        try {
            boolean reachable = prober.test(address);
            return new Probe(address, reachable,
                    reachable ? System.nanoTime() - started : Long.MAX_VALUE);
        } catch (RuntimeException failure) {
            return new Probe(address, false, Long.MAX_VALUE);
        }
    }

    private static void insertByLatency(List<InetAddress> addresses, List<Long> latencies,
                                        InetAddress address, long latencyNanos) {
        int position = 0;
        while (position < latencies.size() && latencies.get(position) <= latencyNanos) {
            position++;
        }
        addresses.add(position, address);
        latencies.add(position, latencyNanos);
    }

    /** 测试与诊断用：清空缓存。 */
    public void clearCache() {
        cache.clear();
    }
}

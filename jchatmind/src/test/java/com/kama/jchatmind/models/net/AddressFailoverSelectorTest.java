package com.kama.jchatmind.models.net;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.net.InetAddress;
import java.net.UnknownHostException;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 地址重排只做一件事：把能连的排前面。这里用假探测器验证排序、缓存和「全坏也不丢地址」，
 * 不验证真实网络行为（那部分靠生产实测）。
 */
class AddressFailoverSelectorTest {

    private static InetAddress address(String host) {
        try {
            return InetAddress.getByName(host);
        } catch (UnknownHostException impossible) {
            throw new IllegalStateException(impossible);
        }
    }

    private static List<InetAddress> threeAddresses() {
        return List.of(address("10.0.0.1"), address("10.0.0.2"), address("10.0.0.3"));
    }

    @Test
    @DisplayName("可达地址排前面，并按握手耗时升序")
    void reachableAddressesComeFirstOrderedByLatency() {
        Map<String, Boolean> reachable = Map.of("10.0.0.1", false, "10.0.0.2", true, "10.0.0.3", true);
        Map<String, Long> latency = Map.of("10.0.0.2", 40_000_000L, "10.0.0.3", 5_000_000L);
        AddressFailoverSelector selector = new AddressFailoverSelector(
                candidate -> reachable.getOrDefault(candidate.getHostAddress(), false), 500, 0);

        List<InetAddress> ordered = selector.reorder("relay.example", threeAddresses());

        assertEquals(3, ordered.size(), "不能因为不可达把地址删掉");
        assertEquals("10.0.0.3", ordered.get(0).getHostAddress(), "更快可达的排第一");
        assertEquals("10.0.0.2", ordered.get(1).getHostAddress());
        assertEquals("10.0.0.1", ordered.get(2).getHostAddress(), "不可达的留作兜底");
        assertTrue(latency.containsKey(ordered.get(0).getHostAddress()));
    }

    @Test
    @DisplayName("全部不可达时保持原始顺序，不退化成空列表")
    void allUnreachableKeepsOriginalOrder() {
        AddressFailoverSelector selector = new AddressFailoverSelector(candidate -> false, 500, 0);

        List<InetAddress> ordered = selector.reorder("relay.example", threeAddresses());

        assertEquals(threeAddresses(), ordered);
    }

    @Test
    @DisplayName("探测抛异常等同于不可达，不向外抛")
    void proberFailureIsTreatedAsUnreachable() {
        AddressFailoverSelector selector = new AddressFailoverSelector(candidate -> {
            if (candidate.getHostAddress().equals("10.0.0.2")) {
                throw new IllegalStateException("probe blew up");
            }
            return true;
        }, 500, 0);

        List<InetAddress> ordered = selector.reorder("relay.example", threeAddresses());

        assertFalse(ordered.get(0).getHostAddress().equals("10.0.0.2"));
        assertEquals(3, ordered.size());
    }

    @Test
    @DisplayName("缓存期内不重复探测")
    void cacheAvoidsRepeatedProbes() {
        AtomicInteger probes = new AtomicInteger();
        AddressFailoverSelector selector = new AddressFailoverSelector(candidate -> {
            probes.incrementAndGet();
            return true;
        }, 500, 60_000);

        selector.reorder("relay.example", threeAddresses());
        int afterFirst = probes.get();
        selector.reorder("relay.example", threeAddresses());

        assertEquals(3, afterFirst, "第一次应探测全部三个地址");
        assertEquals(afterFirst, probes.get(), "缓存期内不应再探测");
    }

    @Test
    @DisplayName("缓存关闭时每次都重新探测")
    void zeroCacheAlwaysProbes() {
        AtomicInteger probes = new AtomicInteger();
        AddressFailoverSelector selector = new AddressFailoverSelector(candidate -> {
            probes.incrementAndGet();
            return true;
        }, 500, 0);

        selector.reorder("relay.example", threeAddresses());
        selector.reorder("relay.example", threeAddresses());

        assertEquals(6, probes.get());
    }

    @Test
    @DisplayName("单地址不探测，直接返回")
    void singleAddressSkipsProbing() {
        AtomicInteger probes = new AtomicInteger();
        AddressFailoverSelector selector = new AddressFailoverSelector(candidate -> {
            probes.incrementAndGet();
            return true;
        }, 500, 0);

        List<InetAddress> one = new ArrayList<>(List.of(address("10.0.0.1")));
        assertEquals(one, selector.reorder("relay.example", one));
        assertEquals(0, probes.get());
    }

    @Test
    @DisplayName("可达集合随时间变化时，下一次缓存过期后重新排序")
    void reorderAfterProbeResultsChange() throws Exception {
        Set<String> reachable = ConcurrentHashMap.newKeySet();
        reachable.add("10.0.0.1");
        AddressFailoverSelector selector = new AddressFailoverSelector(
                candidate -> reachable.contains(candidate.getHostAddress()), 500, 50);

        assertEquals("10.0.0.1", selector.reorder("relay.example", threeAddresses()).get(0).getHostAddress());
        reachable.remove("10.0.0.1");
        reachable.add("10.0.0.3");
        Thread.sleep(120);

        assertEquals("10.0.0.3", selector.reorder("relay.example", threeAddresses()).get(0).getHostAddress());
    }
}

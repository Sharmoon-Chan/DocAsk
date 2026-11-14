package com.kama.jchatmind.models.net;

import java.net.InetAddress;
import java.net.spi.InetAddressResolver;
import java.net.spi.InetAddressResolverProvider;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.stream.Stream;

/**
 * 只对配置里的主机名生效的地址重排：把可达地址排到前面，其余主机名原样交给内置解析器。
 *
 * <p>为什么用 JVM 级解析器而不是改连接器：模型调用走的是 Spring AI 内部的 HTTP 客户端，
 * 我们不方便替换它的连接工厂；而解析器是 JVM 提供的标准扩展点，改在这里对所有客户端一致生效，
 * 也不需要禁用 TLS 校验或改写 Host。</p>
 *
 * <p>配置（系统属性优先，其次环境变量，均为空时不启用，行为与没有这个功能时完全一致）：</p>
 * <ul>
 *   <li>{@code app.models.failover-hosts} / {@code APP_MODELS_FAILOVER_HOSTS}：逗号分隔的主机名</li>
 *   <li>{@code app.models.failover-port} / {@code APP_MODELS_FAILOVER_PORT}：探测端口，默认 443</li>
 *   <li>{@code app.models.failover-probe-timeout-ms} / {@code APP_MODELS_FAILOVER_PROBE_TIMEOUT_MS}：
 *       单次探测超时，默认 800，范围 100–5000</li>
 *   <li>{@code app.models.failover-cache-ms} / {@code APP_MODELS_FAILOVER_CACHE_MS}：结果缓存，默认 30000；0 表示不缓存</li>
 * </ul>
 *
 * <p>注意：fat jar 里的类对系统类加载器不可见，光把 SPI 文件打进 BOOT-INF 不会被 JVM 采用，
 * 需要把同一份类与 SPI 文件放到引导类路径（{@code -Xbootclasspath/a:}），见 deploy/README.md。</p>
 */
public final class FailoverAddressResolverProvider extends InetAddressResolverProvider {

    /** 是否已被 JVM 真正安装（自检用）：只有在 {@link #get} 被调用过之后才是 true。 */
    private static final java.util.concurrent.atomic.AtomicBoolean ACTIVE =
            new java.util.concurrent.atomic.AtomicBoolean();

    public static boolean isActive() {
        return ACTIVE.get();
    }

    @Override
    public InetAddressResolver get(Configuration configuration) {
        InetAddressResolver builtin = configuration.builtinResolver();
        Set<String> hosts = configuredHosts();
        if (hosts.isEmpty()) {
            return builtin;
        }
        int port = (int) longSetting("app.models.failover-port", "APP_MODELS_FAILOVER_PORT", 443L, 1L, 65535L);
        long probeTimeoutMs = longSetting("app.models.failover-probe-timeout-ms",
                "APP_MODELS_FAILOVER_PROBE_TIMEOUT_MS", 800L, 100L, 5_000L);
        long cacheMs = longSetting("app.models.failover-cache-ms", "APP_MODELS_FAILOVER_CACHE_MS",
                30_000L, 0L, 600_000L);
        ACTIVE.set(true);
        AddressFailoverSelector selector = new AddressFailoverSelector(
                address -> canConnect(address, port, probeTimeoutMs), probeTimeoutMs, cacheMs);
        System.getLogger("docask-failover").log(System.Logger.Level.INFO,
                "address failover active: hosts=" + hosts + " port=" + port
                        + " probeTimeoutMs=" + probeTimeoutMs + " cacheMs=" + cacheMs);
        return new FailoverResolver(builtin, selector, hosts);
    }

    @Override
    public String name() {
        return "docask-failover";
    }

    private static boolean canConnect(InetAddress address, int port, long timeoutMs) {
        try (java.net.Socket socket = new java.net.Socket()) {
            socket.connect(new java.net.InetSocketAddress(address, port), (int) timeoutMs);
            return true;
        } catch (Exception unreachable) {
            return false;
        }
    }

    private static Set<String> configuredHosts() {
        String raw = setting("app.models.failover-hosts", "APP_MODELS_FAILOVER_HOSTS");
        Set<String> hosts = new LinkedHashSet<>();
        if (raw == null) {
            return hosts;
        }
        for (String host : raw.split(",")) {
            String trimmed = host.trim().toLowerCase(java.util.Locale.ROOT);
            if (!trimmed.isEmpty()) {
                hosts.add(trimmed);
            }
        }
        return hosts;
    }

    private static String setting(String property, String environment) {
        String value = System.getProperty(property);
        if (value == null || value.trim().isEmpty()) {
            value = System.getenv(environment);
        }
        return value == null || value.trim().isEmpty() ? null : value.trim();
    }

    private static long longSetting(String property, String environment, long fallback, long min, long max) {
        String value = setting(property, environment);
        if (value == null) {
            return fallback;
        }
        try {
            return Math.min(max, Math.max(min, Long.parseLong(value)));
        } catch (NumberFormatException invalid) {
            return fallback;
        }
    }

    /** 对配置的主机名重排地址，其余主机名直接委托给内置解析器。 */
    private static final class FailoverResolver implements InetAddressResolver {

        private final InetAddressResolver builtin;
        private final AddressFailoverSelector selector;
        private final Set<String> hosts;

        private FailoverResolver(InetAddressResolver builtin, AddressFailoverSelector selector, Set<String> hosts) {
            this.builtin = builtin;
            this.selector = selector;
            this.hosts = hosts;
        }

        @Override
        public Stream<InetAddress> lookupByName(String host, LookupPolicy lookupPolicy) throws java.net.UnknownHostException {
            Stream<InetAddress> resolved = builtin.lookupByName(host, lookupPolicy);
            if (host == null || !hosts.contains(host.toLowerCase(java.util.Locale.ROOT))) {
                return resolved;
            }
            List<InetAddress> addresses = new ArrayList<>();
            resolved.forEach(addresses::add);
            if (addresses.size() <= 1) {
                return addresses.stream();
            }
            List<InetAddress> ordered = selector.reorder(host.toLowerCase(java.util.Locale.ROOT), addresses);
            return ordered.stream();
        }

        @Override
        public String lookupByAddress(byte[] address) throws java.net.UnknownHostException {
            return builtin.lookupByAddress(address);
        }
    }
}

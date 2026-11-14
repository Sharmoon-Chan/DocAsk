package com.kama.jchatmind.models.net;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.Socket;

/**
 * 启动自检：把「地址重排有没有生效」和「某个主机名现在的地址顺序」写进日志。
 *
 * <p>为什么需要自检：JVM 的解析器是延迟加载且只加载一次，出问题时表现是「没有任何日志、行为与改动前一样」，
 * 只有主动查一次才能区分「功能没生效」和「生效但这次运气好没遇到坏地址」。</p>
 */
@Component
public class FailoverDiagnostics {

    private static final Logger log = LoggerFactory.getLogger(FailoverDiagnostics.class);

    @EventListener(ApplicationReadyEvent.class)
    public void report() {
        String hosts = System.getenv("APP_MODELS_FAILOVER_HOSTS");
        if (hosts == null || hosts.trim().isEmpty()) {
            hosts = System.getProperty("app.models.failover-hosts");
        }
        if (hosts == null || hosts.trim().isEmpty()) {
            log.info("address failover disabled: no APP_MODELS_FAILOVER_HOSTS configured");
            return;
        }
        log.info("address failover provider active={}", FailoverAddressResolverProvider.isActive());
        for (String host : hosts.split(",")) {
            String name = host.trim();
            if (name.isEmpty()) {
                continue;
            }
            reportHost(name);
        }
    }

    private void reportHost(String host) {
        try {
            InetAddress[] addresses = InetAddress.getAllByName(host);
            StringBuilder order = new StringBuilder();
            for (InetAddress address : addresses) {
                long started = System.nanoTime();
                boolean reachable = canConnect(address, 443, 800);
                long millis = (System.nanoTime() - started) / 1_000_000L;
                if (order.length() > 0) {
                    order.append(", ");
                }
                order.append(address.getHostAddress());
                order.append(reachable ? "(" + millis + "ms)" : "(unreachable)");
            }
            log.info("address failover order for {}: {}", host, order);
        } catch (Exception failure) {
            log.warn("address failover could not resolve {}: {}", host, failure.toString());
        }
    }

    private static boolean canConnect(InetAddress address, int port, int timeoutMs) {
        try (Socket socket = new Socket()) {
            socket.connect(new InetSocketAddress(address, port), timeoutMs);
            return true;
        } catch (Exception unreachable) {
            return false;
        }
    }
}

package com.kama.jchatmind.models;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

@Component
@ConfigurationProperties(prefix = "app.models")
public class ModelSettings {
    private String encryptionKeyFile = "";
    private int requestTimeoutSeconds = 90;
    private int llmConnectTimeoutSeconds = 5;
    private int llmReadTimeoutSeconds = 30;

    public String getEncryptionKeyFile() { return encryptionKeyFile; }
    public void setEncryptionKeyFile(String encryptionKeyFile) { this.encryptionKeyFile = encryptionKeyFile; }
    public int getRequestTimeoutSeconds() { return Math.min(120, Math.max(5, requestTimeoutSeconds)); }
    public void setRequestTimeoutSeconds(int seconds) { this.requestTimeoutSeconds = seconds; }
    /** LLM timeouts are independent of the existing Embedding timeout. */
    public int getLlmConnectTimeoutSeconds() { return Math.min(10, Math.max(1, llmConnectTimeoutSeconds)); }
    public void setLlmConnectTimeoutSeconds(int seconds) { this.llmConnectTimeoutSeconds = seconds; }
    public int getLlmReadTimeoutSeconds() { return Math.min(120, Math.max(1, llmReadTimeoutSeconds)); }
    public void setLlmReadTimeoutSeconds(int seconds) { this.llmReadTimeoutSeconds = seconds; }
}

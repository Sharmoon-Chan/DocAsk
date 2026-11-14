package com.kama.jchatmind.models;

import java.util.Objects;

/** Carries only safe model-request diagnostics; the raw provider cause is deliberately discarded. */
public final class ModelCallException extends ModelException {
    private final ModelCallFailure failure;

    public ModelCallException(ModelCallFailure failure) {
        super(502, "语言模型服务暂不可用，请稍后重试");
        this.failure = Objects.requireNonNull(failure, "failure");
    }

    public ModelCallFailure failure() {
        return failure;
    }
}

-- Additive event vocabulary for validated source delivery. Existing rows are unchanged.
BEGIN;

ALTER TABLE exobrain_run_event
    DROP CONSTRAINT IF EXISTS exobrain_run_event_type_check;

ALTER TABLE exobrain_run_event
    ADD CONSTRAINT exobrain_run_event_type_check
    CHECK (type IN ('MODEL_CALL', 'MODEL_RETRY', 'TOOL_CALL', 'RETRIEVAL',
                    'PERSIST_MESSAGE', 'STEP_LIMIT', 'ERROR',
                    'DELIVERY_REPAIR', 'ANSWER_FALLBACK'));

COMMIT;

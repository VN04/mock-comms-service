import { MigrationInterface, QueryRunner } from 'typeorm';

const CALL_STATUS = `'QUEUED','RINGING','ANSWERED','UNANSWERED','COMPLETED'`;

/** api_keys, calls and call_events. */
export class InitialSchema1727700000000 implements MigrationInterface {
  name = 'InitialSchema1727700000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE api_keys (
        id                   CHAR(36)     NOT NULL,
        name                 VARCHAR(100) NOT NULL,
        key_prefix           VARCHAR(16)  NOT NULL,
        key_hash             CHAR(64)     NOT NULL,
        role                 ENUM('admin','client') NOT NULL DEFAULT 'client',
        max_concurrent_calls INT          NULL,
        max_cps              INT          NULL,
        is_active            TINYINT(1)   NOT NULL DEFAULT 1,
        created_at           DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        updated_at           DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        revoked_at           DATETIME(3)  NULL,
        PRIMARY KEY (id),
        UNIQUE KEY uq_api_keys_key_hash (key_hash)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await q.query(`
      CREATE TABLE calls (
        id                    CHAR(36)      NOT NULL,
        api_key_id            CHAR(36)      NOT NULL,
        from_number           VARCHAR(20)   NOT NULL,
        to_number             VARCHAR(20)   NOT NULL,
        metadata              JSON          NULL,
        status                ENUM(${CALL_STATUS}) NOT NULL,
        outcome               ENUM('ANSWERED','UNANSWERED') NULL,
        provider              VARCHAR(32)   NOT NULL,
        queued_at             DATETIME(3)   NOT NULL,
        ringing_at            DATETIME(3)   NULL,
        answered_at           DATETIME(3)   NULL,
        unanswered_at         DATETIME(3)   NULL,
        completed_at          DATETIME(3)   NULL,
        recording_status      ENUM('PENDING','UPLOADED','FAILED') NULL,
        recording_key         VARCHAR(255)  NULL,
        recording_url         VARCHAR(1024) NULL,
        recording_uploaded_at DATETIME(3)   NULL,
        created_at            DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        updated_at            DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        PRIMARY KEY (id),
        KEY idx_calls_api_key_status (api_key_id, status),
        KEY idx_calls_created_at (created_at),
        CONSTRAINT fk_calls_api_key FOREIGN KEY (api_key_id) REFERENCES api_keys (id) ON DELETE RESTRICT
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await q.query(`
      CREATE TABLE call_events (
        id          BIGINT       NOT NULL AUTO_INCREMENT,
        call_id     CHAR(36)     NOT NULL,
        sequence    INT          NOT NULL,
        event_type  ENUM('CALL_CREATED','STATUS_CHANGED','TRANSITION_SKIPPED','RECORDING_UPLOAD_SUCCEEDED','RECORDING_UPLOAD_FAILED') NOT NULL,
        from_status ENUM(${CALL_STATUS}) NULL,
        to_status   ENUM(${CALL_STATUS}) NULL,
        payload     JSON         NULL,
        occurred_at DATETIME(3)  NOT NULL,
        created_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        PRIMARY KEY (id),
        UNIQUE KEY uq_call_events_call_sequence (call_id, sequence),
        KEY idx_call_events_type_occurred (event_type, occurred_at),
        CONSTRAINT fk_call_events_call FOREIGN KEY (call_id) REFERENCES calls (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TABLE call_events');
    await q.query('DROP TABLE calls');
    await q.query('DROP TABLE api_keys');
  }
}

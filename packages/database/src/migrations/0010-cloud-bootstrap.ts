export const cloudBootstrapSql = `
CREATE TABLE cloud_sync_bootstrap (id integer PRIMARY KEY CHECK(id=1), remote_id text NOT NULL DEFAULT '', revision text NOT NULL DEFAULT '0', next_page integer NOT NULL DEFAULT 0, entities_json text NOT NULL DEFAULT '[]', complete integer NOT NULL DEFAULT 0 CHECK(complete IN(0,1)));
`.trim();

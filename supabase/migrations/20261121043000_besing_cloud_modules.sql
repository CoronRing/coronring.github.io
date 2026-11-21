-- BESing shared cloud modules: generic namespaced LWW KV store (for Settings Sync
-- and future lightweight BESing scripts) + Quick Transfer (text/image/file drops
-- up to 5 MB with 48-hour automatic expiry).
--
-- Shares `public.besing_sync_spaces` and `public._besing_sync_auth(p_secret)` from
-- 20261121000000_besing_sync.sql. Every table has RLS enabled with zero policies
-- and revoked direct privileges for `anon` and `authenticated`.

-- ---------------------------------------------------------------------------
-- 1. Generic Namespaced Key-Value Store (Settings Sync + Future Scripts)
-- ---------------------------------------------------------------------------

create table if not exists public.besing_script_kv (
    space_hash text not null references public.besing_sync_spaces(space_hash) on delete cascade,
    namespace  text not null check (namespace ~ '^[a-z0-9][a-z0-9_-]{1,63}$'),
    item_key   text not null check (char_length(item_key) between 1 and 160),
    value_json jsonb not null default 'null'::jsonb,
    deleted    boolean not null default false,
    updated_ms bigint not null check (updated_ms >= 0),
    updated_by text not null default '' check (char_length(updated_by) <= 80),
    synced_at  timestamptz not null default now(),
    expires_at timestamptz,
    primary key (space_hash, namespace, item_key)
);

create index if not exists idx_besing_script_kv_space_ns_synced
    on public.besing_script_kv (space_hash, namespace, synced_at desc);

comment on table public.besing_script_kv is
    'Namespaced Last-Write-Wins (UTC ms) key-value store shared by Settings Sync '
    'and future lightweight BESing scripts without requiring new tables per script.';

alter table public.besing_script_kv enable row level security;
revoke all on table public.besing_script_kv from public, anon, authenticated;

-- RPC: Atomic LWW push + delta pull for one script namespace.
create or replace function public.besing_kv_sync(
    p_secret    text,
    p_namespace text,
    p_entries   jsonb default '[]'::jsonb,
    p_since     timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
    v_space       public.besing_sync_spaces;
    v_now         timestamptz := now();
    v_now_ms      bigint := floor(extract(epoch from v_now) * 1000)::bigint;
    v_ns          text;
    v_entry       jsonb;
    v_key         text;
    v_val         jsonb;
    v_deleted     boolean;
    v_updated_ms  bigint;
    v_updated_by  text;
    v_expires_at  timestamptz;
    v_existing_ct integer;
    v_accepted    integer := 0;
    v_conflicts   integer := 0;
    v_rows        jsonb;
begin
    v_space := public._besing_sync_auth(p_secret);

    v_ns := lower(btrim(coalesce(p_namespace, '')));
    if v_ns !~ '^[a-z0-9][a-z0-9_-]{1,63}$' then
        raise exception 'invalid namespace' using errcode = '22023';
    end if;

    if p_entries is not null then
        if jsonb_typeof(p_entries) <> 'array' then
            raise exception 'entries must be an array' using errcode = '22023';
        end if;
        if octet_length(p_entries::text) > 262144 then
            raise exception 'payload too large' using errcode = '22023';
        end if;

        select count(*) into v_existing_ct
        from public.besing_script_kv
        where space_hash = v_space.space_hash and namespace = v_ns;

        for v_entry in
            select elem
            from jsonb_array_elements(p_entries) with ordinality as arr(elem, ord)
            where ord <= 100
        loop
            if jsonb_typeof(v_entry) <> 'object' then
                continue;
            end if;
            v_key := left(btrim(coalesce(v_entry ->> 'key', '')), 160);
            if char_length(v_key) = 0 then
                continue;
            end if;

            v_val := coalesce(v_entry -> 'value', 'null'::jsonb);
            if octet_length(v_val::text) > 65536 then
                continue;
            end if;

            v_deleted := coalesce((v_entry ->> 'deleted')::boolean, false);
            begin
                v_updated_ms := coalesce((v_entry ->> 'updated_ms')::bigint, v_now_ms);
            exception when others then
                v_updated_ms := v_now_ms;
            end;
            -- Clamp far-future client clocks to server time + 2 minutes so one bad clock cannot win forever.
            if v_updated_ms > v_now_ms + 120000 then
                v_updated_ms := v_now_ms;
            end if;
            if v_updated_ms < 0 then
                v_updated_ms := v_now_ms;
            end if;

            v_updated_by := left(btrim(coalesce(v_entry ->> 'updated_by', '')), 80);

            v_expires_at := null;
            if v_entry ? 'ttl_hours' then
                begin
                    v_expires_at := v_now + make_interval(hours => greatest(1, least(720, (v_entry ->> 'ttl_hours')::integer)));
                exception when others then
                    v_expires_at := null;
                end;
            elsif v_deleted then
                -- Keep deletion tombstones for 30 days so offline devices receive them, then auto-prune.
                v_expires_at := v_now + interval '30 days';
            end if;

            if not exists (
                select 1 from public.besing_script_kv
                where space_hash = v_space.space_hash and namespace = v_ns and item_key = v_key
            ) then
                if v_existing_ct >= 500 then
                    continue;
                end if;
                insert into public.besing_script_kv (
                    space_hash, namespace, item_key, value_json, deleted,
                    updated_ms, updated_by, synced_at, expires_at
                ) values (
                    v_space.space_hash, v_ns, v_key, v_val, v_deleted,
                    v_updated_ms, v_updated_by, v_now, v_expires_at
                );
                v_existing_ct := v_existing_ct + 1;
                v_accepted := v_accepted + 1;
            else
                update public.besing_script_kv
                set value_json = v_val,
                    deleted    = v_deleted,
                    updated_ms = v_updated_ms,
                    updated_by = v_updated_by,
                    synced_at  = v_now,
                    expires_at = v_expires_at
                where space_hash = v_space.space_hash
                  and namespace  = v_ns
                  and item_key   = v_key
                  and updated_ms <= v_updated_ms;

                if found then
                    v_accepted := v_accepted + 1;
                else
                    v_conflicts := v_conflicts + 1;
                end if;
            end if;
        end loop;
    end if;

    -- Prune expired TTL items and old tombstones for this namespace.
    delete from public.besing_script_kv
    where space_hash = v_space.space_hash
      and namespace  = v_ns
      and expires_at is not null
      and expires_at < v_now;

    update public.besing_sync_spaces
    set last_activity_at = v_now
    where space_hash = v_space.space_hash;

    select coalesce(jsonb_agg(
        jsonb_build_object(
            'key', k.item_key,
            'value', k.value_json,
            'deleted', k.deleted,
            'updated_ms', k.updated_ms,
            'updated_by', k.updated_by,
            'synced_at', k.synced_at
        )
        order by k.updated_ms desc
    ), '[]'::jsonb)
    into v_rows
    from public.besing_script_kv k
    where k.space_hash = v_space.space_hash
      and k.namespace  = v_ns
      and (p_since is null or k.synced_at > p_since);

    return jsonb_build_object(
        'ok', true,
        'server_time', v_now,
        'namespace', v_ns,
        'accepted', v_accepted,
        'stale_ignored', v_conflicts,
        'entries', v_rows
    );
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Quick Transfer / Drop (Text, Clipboard Image, or File <= 5 MB, 2d TTL)
-- ---------------------------------------------------------------------------

create table if not exists public.besing_transfers (
    id           uuid primary key default gen_random_uuid(),
    space_hash   text not null references public.besing_sync_spaces(space_hash) on delete cascade,
    title        text not null default 'Untitled' check (char_length(title) <= 160),
    kind         text not null check (kind in ('text', 'image', 'file')),
    mime_type    text not null default 'text/plain' check (char_length(mime_type) <= 120),
    file_name    text not null default '' check (char_length(file_name) <= 180),
    size_bytes   integer not null check (size_bytes between 0 and 5242880),
    content_text text not null,
    preview_text text not null default '' check (char_length(preview_text) <= 240),
    sender_name  text not null default '' check (char_length(sender_name) <= 80),
    created_at   timestamptz not null default now(),
    expires_at   timestamptz not null default (now() + interval '2 days')
);

create index if not exists idx_besing_transfers_space_created
    on public.besing_transfers (space_hash, created_at desc);

create index if not exists idx_besing_transfers_expires
    on public.besing_transfers (expires_at);

comment on table public.besing_transfers is
    'Temporary cross-device text, image, and file transfers (max 5 MB each, auto-expires in 2 days).';

alter table public.besing_transfers enable row level security;
revoke all on table public.besing_transfers from public, anon, authenticated;

-- RPC: Upload a transfer item (text, base64 image, or base64 file <= 5 MB raw).
create or replace function public.besing_transfer_put(
    p_secret  text,
    p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
    v_space       public.besing_sync_spaces;
    v_now         timestamptz := now();
    v_kind        text;
    v_title       text;
    v_mime        text;
    v_file_name   text;
    v_content     text;
    v_preview     text;
    v_sender      text;
    v_size_bytes  integer;
    v_ttl_hours   integer;
    v_total_bytes bigint;
    v_total_count integer;
    v_id          uuid;
    v_expires_at  timestamptz;
begin
    v_space := public._besing_sync_auth(p_secret);

    if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
        raise exception 'invalid payload' using errcode = '22023';
    end if;

    -- Always prune expired transfers first so quota reflects active items only.
    delete from public.besing_transfers
    where space_hash = v_space.space_hash
      and expires_at < v_now;

    v_kind := lower(btrim(coalesce(p_payload ->> 'kind', 'text')));
    if v_kind not in ('text', 'image', 'file') then
        raise exception 'invalid kind' using errcode = '22023';
    end if;

    v_content := coalesce(p_payload ->> 'content', '');
    if char_length(v_content) = 0 then
        raise exception 'empty content' using errcode = '22023';
    end if;

    -- 5 MB raw binary encoded in base64 is ~6,990,508 chars; cap encoded text at 7.2M chars.
    if char_length(v_content) > 7200000 then
        raise exception 'transfer exceeds 5 MB limit' using errcode = '22023';
    end if;

    if v_kind = 'text' then
        v_size_bytes := octet_length(v_content);
    else
        begin
            v_size_bytes := coalesce((p_payload ->> 'size_bytes')::integer, floor(char_length(v_content) * 3 / 4)::integer);
        exception when others then
            v_size_bytes := floor(char_length(v_content) * 3 / 4)::integer;
        end;
    end if;

    if v_size_bytes < 0 or v_size_bytes > 5242880 then
        raise exception 'transfer exceeds 5 MB limit' using errcode = '22023';
    end if;

    select count(*), coalesce(sum(size_bytes), 0)
    into v_total_count, v_total_bytes
    from public.besing_transfers
    where space_hash = v_space.space_hash;

    if v_total_count >= 50 then
        raise exception 'too many active transfers (max 50); delete older items first' using errcode = '54000';
    end if;
    if v_total_bytes + v_size_bytes > 41943040 then
        raise exception 'active transfer storage limit reached (40 MB); delete older items first' using errcode = '54000';
    end if;

    v_title     := left(coalesce(nullif(btrim(p_payload ->> 'title'), ''), 'Untitled'), 160);
    v_mime      := left(coalesce(nullif(btrim(p_payload ->> 'mime_type'), ''), case when v_kind = 'text' then 'text/plain' else 'application/octet-stream' end), 120);
    v_file_name := left(btrim(coalesce(p_payload ->> 'file_name', '')), 180);
    v_sender    := left(btrim(coalesce(p_payload ->> 'sender_name', '')), 80);
    v_preview   := left(
        coalesce(
            nullif(btrim(p_payload ->> 'preview_text'), ''),
            case when v_kind = 'text' then regexp_replace(left(v_content, 240), '\s+', ' ', 'g') else v_file_name end
        ),
        240
    );

    begin
        v_ttl_hours := greatest(1, least(48, coalesce((p_payload ->> 'ttl_hours')::integer, 48)));
    exception when others then
        v_ttl_hours := 48;
    end;
    v_expires_at := v_now + make_interval(hours => v_ttl_hours);

    insert into public.besing_transfers (
        space_hash, title, kind, mime_type, file_name, size_bytes,
        content_text, preview_text, sender_name, created_at, expires_at
    ) values (
        v_space.space_hash, v_title, v_kind, v_mime, v_file_name, v_size_bytes,
        v_content, v_preview, v_sender, v_now, v_expires_at
    )
    returning id into v_id;

    update public.besing_sync_spaces
    set last_activity_at = v_now
    where space_hash = v_space.space_hash;

    return jsonb_build_object(
        'ok', true,
        'id', v_id,
        'title', v_title,
        'kind', v_kind,
        'size_bytes', v_size_bytes,
        'created_at', v_now,
        'expires_at', v_expires_at
    );
end;
$$;

-- RPC: List active transfers (metadata + inline content ONLY for small <= 2 KB text snippets).
create or replace function public.besing_transfer_list(
    p_secret text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
    v_space public.besing_sync_spaces;
    v_now   timestamptz := now();
    v_items jsonb;
begin
    v_space := public._besing_sync_auth(p_secret);

    delete from public.besing_transfers
    where space_hash = v_space.space_hash
      and expires_at < v_now;

    select coalesce(jsonb_agg(
        jsonb_build_object(
            'id', t.id,
            'title', t.title,
            'kind', t.kind,
            'mime_type', t.mime_type,
            'file_name', t.file_name,
            'size_bytes', t.size_bytes,
            'preview_text', t.preview_text,
            'inline_text', case when t.kind = 'text' and t.size_bytes <= 2048 then t.content_text else null end,
            'sender_name', t.sender_name,
            'created_at', t.created_at,
            'expires_at', t.expires_at
        )
        order by t.created_at desc
    ), '[]'::jsonb)
    into v_items
    from public.besing_transfers t
    where t.space_hash = v_space.space_hash;

    return jsonb_build_object(
        'ok', true,
        'server_time', v_now,
        'items', v_items
    );
end;
$$;

-- RPC: Fetch full transfer payload on demand (only when user opens/downloads an item).
create or replace function public.besing_transfer_get(
    p_secret text,
    p_id     uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
    v_space public.besing_sync_spaces;
    v_now   timestamptz := now();
    v_row   public.besing_transfers;
begin
    v_space := public._besing_sync_auth(p_secret);

    select * into v_row
    from public.besing_transfers
    where space_hash = v_space.space_hash
      and id = p_id
      and expires_at >= v_now;

    if not found then
        raise exception 'transfer not found or expired' using errcode = 'P0002';
    end if;

    return jsonb_build_object(
        'ok', true,
        'id', v_row.id,
        'title', v_row.title,
        'kind', v_row.kind,
        'mime_type', v_row.mime_type,
        'file_name', v_row.file_name,
        'size_bytes', v_row.size_bytes,
        'content', v_row.content_text,
        'sender_name', v_row.sender_name,
        'created_at', v_row.created_at,
        'expires_at', v_row.expires_at
    );
end;
$$;

-- RPC: Delete a transfer immediately.
create or replace function public.besing_transfer_delete(
    p_secret text,
    p_id     uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
    v_space   public.besing_sync_spaces;
    v_deleted integer := 0;
begin
    v_space := public._besing_sync_auth(p_secret);

    delete from public.besing_transfers
    where space_hash = v_space.space_hash
      and id = p_id;
    get diagnostics v_deleted = row_count;

    return jsonb_build_object('ok', true, 'deleted', v_deleted > 0);
end;
$$;

revoke all on function public.besing_kv_sync(text, text, jsonb, timestamptz) from public;
revoke all on function public.besing_transfer_put(text, jsonb) from public;
revoke all on function public.besing_transfer_list(text) from public;
revoke all on function public.besing_transfer_get(text, uuid) from public;
revoke all on function public.besing_transfer_delete(text, uuid) from public;

grant execute on function public.besing_kv_sync(text, text, jsonb, timestamptz) to anon, authenticated;
grant execute on function public.besing_transfer_put(text, jsonb) to anon, authenticated;
grant execute on function public.besing_transfer_list(text) to anon, authenticated;
grant execute on function public.besing_transfer_get(text, uuid) to anon, authenticated;
grant execute on function public.besing_transfer_delete(text, uuid) to anon, authenticated;

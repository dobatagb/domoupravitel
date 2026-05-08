# Модул „Събрания“ — пълно описание

> Последна актуализация: 2026-05-08
>
> Маршрути: `/meetings` (списък + създаване) и `/meetings/:meetingId` (преглед/редакция).
> Печатна версия: `/meetings/:meetingId/print` (отделен route, без sidebar).

## Съдържание

1. [Общ преглед](#1-общ-преглед)
2. [Роли и права](#2-роли-и-права)
3. [Жизнен цикъл на едно събрание](#3-жизнен-цикъл-на-едно-събрание)
4. [Кворум — фази и проценти](#4-кворум--фази-и-проценти)
5. [Дневен ред и гласуване](#5-дневен-ред-и-гласуване)
6. [Прозрачност, кой какво вижда](#6-прозрачност-кой-какво-вижда)
7. [Real-time (WebSocket)](#7-real-time-websocket)
8. [Уведомления (in-app + email outbox)](#8-уведомления-in-app--email-outbox)
9. [Протокол и PDF](#9-протокол-и-pdf)
10. [Структура на базата данни](#10-структура-на-базата-данни)
11. [PostgreSQL функции и тригери](#11-postgresql-функции-и-тригери)
12. [Frontend архитектура](#12-frontend-архитектура)
13. [История на миграциите 061–075](#13-история-на-миграциите-061075)
14. [Известни ограничения / отложено](#14-известни-ограничения--отложено)

---

## 1. Общ преглед

Модулът „Събрания“ покрива пълния процес на провеждане на **общо събрание на собствениците** в етажна собственост, съобразен със **ЗУЕС** (Закон за управление на етажната собственост):

- Създаване и свикване (с публикувана покана минимум 7 дни предварително).
- Маркиране на присъстващи (по обект — апартамент, гараж, мазе и т.н.).
- Автоматично изчисляване на **кворум** в реално време, с правилните прагове за първо и второ свикване и с **повишен праг 75 %** при наличие на собственик с > 51 % ид. части.
- Точки от дневен ред с **един глас на собственик** и тегло = сума ид. части от присъстващите му обекти.
- **Решение по точка**: обикновено мнозинство — > 50 % ид. части от присъстващите.
- Уведомления (in-app + email outbox), live updates, PDF протокол.

---

## 2. Роли и права

В системата има две роли в `public.users.role`:

| Роля     | Може да...                                                                                |
| -------- | ----------------------------------------------------------------------------------------- |
| `admin`  | Създава/редактира/изтрива събрания, точки, присъстващи; записва глас от името на друг.    |
| `viewer` | Гледа всички събрания и точки; гласува **само** от свое име, **само** ако е представен.   |

Технически проверки:

- `public.is_admin()` — RLS guard за всички INSERT/UPDATE/DELETE по `meetings`, `meeting_attendees`, `meeting_agenda_items`.
- `can_vote_meeting_agenda_item(p_agenda_item_id)` — TRUE ако точката е `open` И текущият потребител има поне един **присъстващ** обект през `user_unit_links`.
- За ръчен запис на глас от админ за чужд собственик: `meeting_agenda_target_may_vote(item, target_user)`.

> Премахването на роля `editor` (миграция 061) — всички бивши `editor` са станали `admin`. RPC `is_editor_or_admin()` остава като псевдоним на `is_admin()` за обратна съвместимост.

---

## 3. Жизнен цикъл на едно събрание

Поле `meetings.status` (миграция 075) приема три стойности:

| Статус    | Какво означава                                                          | Видимост          | Нотификации                        |
| --------- | ----------------------------------------------------------------------- | ----------------- | ---------------------------------- |
| `draft`   | Чернова — admin подготвя в спокойствие                                  | Виждат я всички, но с banner „Чернова“ | **Не** се пращат                  |
| `active`  | Свикано и в ход — кворумът се мери, точките могат да се гласуват        | Виждат я всички   | Пускат се всички тригери           |
| `closed`  | Приключено — UI не позволява промени по присъстващи и точки             | Виждат я всички   | Без нови (само за тази точка)      |

Преходи (UI бутони в hero-то):

```
draft  ──[Свикай]──►  active  ──[Приключи]──►  closed
                      ▲
              [Преоткрий]
                      │
                      └────────────────────────  closed
```

Нотификация „ново събрание“ се пуска **само** при INSERT със `status='active'` ИЛИ при преход `draft → active` (виж [§11 Тригери](#11-postgresql-функции-и-тригери)).

Дата на публикувана покана: `meetings.convening_notice_posted_at` (nullable). При активно събрание UI показва:

- ✅ зелено „N дни преди начало“ ако ≥ 7
- ⚠ червено „Само N дни (минимум 7)“ ако е по-малко

---

## 4. Кворум — фази и проценти

Реализирано в `src/lib/meetingQuorum.ts`. Всичко се преизчислява **на клиента** при всяка промяна, със сървърно време от `public.server_now()`.

### Фази

`getMeetingPhase(conveningStartedAt, serverNow)`:

| Фаза     | Условие                                       | Праг (нормален) | Праг (повишен 75 %) |
| -------- | --------------------------------------------- | --------------- | ------------------- |
| `first`  | `serverNow − convening_started_at < 60 min`   | **51 %**        | **75 %**            |
| `second` | `serverNow − convening_started_at ≥ 60 min`   | **33 %**        | **75 %**            |

### Повишен праг 75 %

`computeElevatedQuorumRequired(shareByUnitId, links)`:

> TRUE ако **сумата ид. части по всички обекти на който и да е потребител > 51 %.**

Логика: ако един собственик държи повече от половината идеални части, законът изисква 75 % кворум и в двете фази, за да не може еднолично да налага решения.

### Изчисление на представени ид. части

Сума на `units.building_ideal_share_percent` за всички **запазени** в `meeting_attendees` обекти на това събрание (един обект = веднъж).

> ⚠ Важно (бъг от ранните версии, поправен): KPI-картата за кворум **трябва** да чете от запазените в БД присъстващи, а **не** от draft-а на admin-а. Иначе кворум „мърда“ при кликане без запис. Защитено е чрез отделен state `savedAttendeeUnitIds` + dirty бадж.

---

## 5. Дневен ред и гласуване

### Точки (`meeting_agenda_items`)

- `sort_order`: цяло число (стъпка 10) — DnD пренареждане прави bulk update `(idx+1)*10` за всички точки.
- `voting_status` (миграция 066): `open` (по подразбиране) или `closed`. Само admin сменя.
- Шаблони (`src/lib/meetingAgendaTemplates.ts`): 9 готови (избор на домоуправител, контролен съвет, бюджет, промяна на месечна вноска, ремонт, фонд „Ремонт и обновяване“, правила, енергийно обновяване, други). Дропдаун в add-формата попълва title + description.

### Гласове (`meeting_agenda_votes`)

Един ред = **един потребител** (не един обект) → миграция 065. Полета:

```
agenda_item_id  →  meeting_agenda_items.id
user_id         →  auth.users.id
vote            ∈ ('for', 'against', 'abstain')
voted_at        timestamp (auto)
meeting_id      денормализирано (за Realtime филтър — миграция 072)
```

Тегло на глас = **сума ид. части по присъстващите обекти на потребителя**. Например: ако имаш ап. 3 (5.42 %) и гараж 7 (0.31 %), и двата са в списъка с присъстващи → твоят глас тежи 5.73 %.

### RPC функции за гласуване (миграции 069–071)

| Функция                                   | Кой я вика                | Какво прави                                    |
| ----------------------------------------- | ------------------------- | ---------------------------------------------- |
| `meeting_agenda_vote_upsert_self(item, vote)`             | всеки представен потребител | Гласува от свое име                            |
| `meeting_agenda_vote_upsert_for_user(item, vote, target)` | само admin                | Записва глас от името на друг (на място)       |

И двете правят `INSERT ... ON CONFLICT (agenda_item_id, user_id) DO UPDATE SET vote = EXCLUDED.vote`. Грешките връщат **на български** (миграция 071) — например „Точката не е отворена за гласуване“, „Нямате сред присъстващите маркиран обект...“.

### Решение по точка (decision threshold)

Реализирано в `src/lib/meetingVoteAggregate.ts`:

```ts
DECISION_REQUIRED_PERCENT = 50

forPercentOfEligible = (forShare / eligibleShareTotal) * 100
passed = eligibleShareTotal > 0 && forPercentOfEligible > 50
```

> **Обикновено мнозинство**: за да е прието, „за“ трябва да е **строго над 50 %** от **всички присъстващи** ид. части (не само от гласувалите). Въздържалите се и неучаствалите ефективно работят като „против“.

UI показва „Прието“ / „Отхвърлено“ pill в реда с точката само след `voting_status='closed'`. KPI картата за дневен ред брои `N приети · M отхвърлени`.

---

## 6. Прозрачност, кой какво вижда

| Данни                            | Admin    | Viewer (представен) | Viewer (непредставен) |
| -------------------------------- | -------- | ------------------- | --------------------- |
| Списък със събрания              | ✅       | ✅                  | ✅                    |
| Детайли + дневен ред             | ✅       | ✅                  | ✅                    |
| Списък присъстващи (с имена)     | ✅       | ✅                  | ✅                    |
| Гласове по точка (агрегати)      | ✅       | ✅                  | ✅                    |
| Гласове по точка (поименно)      | ✅       | ✅                  | ✅                    |
| Подаване на свой глас            | —        | ✅ (ако точката е open) | ❌                |
| Запис на чужд глас (на място)    | ✅       | ❌                  | ❌                    |
| Промяна на статус, точки и т.н.  | ✅       | ❌                  | ❌                    |

> **Защо viewer вижда поименно?** Защото няма тайно гласуване — потребителят изрично потвърди това. По-късно е лесно да се сложи флаг `secret_ballot` на точка, ако се промени политиката.
>
> Прозрачността по `user_unit_links` е дадена с миграция 067 — без нея клиентът не би могъл да агрегира чуждите гласове.

---

## 7. Real-time (WebSocket)

### Как работи

Supabase Realtime ползва PostgreSQL **logical replication** (`wal2json`) → WebSocket. На фронтенда:

```ts
supabase
  .channel(`meeting-${meetingId}`)
  .on('postgres_changes', { event: '*', schema: 'public',
       table: 'meeting_agenda_items', filter: `meeting_id=eq.${meetingId}` }, scheduleAgenda)
  .on('postgres_changes', { event: '*', schema: 'public',
       table: 'meeting_agenda_votes', filter: `meeting_id=eq.${meetingId}` }, scheduleAgenda)
  .on('postgres_changes', { event: '*', schema: 'public',
       table: 'meeting_attendees',    filter: `meeting_id=eq.${meetingId}` }, scheduleAttendees)
  .subscribe(...)
```

Миграция **072** прави следното, за да заработи това:

1. Денормализира `meeting_id` в `meeting_agenda_votes` (с trigger `BEFORE INSERT`, който го попълва от `meeting_agenda_items`) — за `filter=eq.meeting_id`.
2. `REPLICA IDENTITY FULL` на трите таблици — за пълни UPDATE/DELETE payload-и.
3. Добавя ги в `supabase_realtime` публикацията.

### Поведение в UI

- Pill в hero: **На живо** (зелено) / **Свързване...** / **Офлайн** (червено).
- Debounce ~250 ms на refresh — защитава срещу спам при bulk операции (DnD).
- Special-case: ако admin е в режим редакция и има непазен draft на присъстващи, **не** се пренаписва от Realtime (за да не се изтрият неговите кликвания).

---

## 8. Уведомления (in-app + email outbox)

Миграция **074**. Две таблици:

- `notifications` — in-app, RLS „виждам само своите“, Realtime-видимо на собствения user.
- `notification_outbox` — опашка за email dispatcher (Edge Function — **отложено**, виж §14). Service-role only.

### Видове и кой ги получава

| `kind`                | Кога                                          | Получатели                                   |
| --------------------- | --------------------------------------------- | -------------------------------------------- |
| `meeting_created`     | Ново събрание (`status='active'` или draft→active) | **Всички** регистрирани собственици (`user_unit_links`) |
| `agenda_item_opened`  | Точка преминава в `voting_status='open'`      | Само **присъстващите** на това събрание      |
| `agenda_item_closed`  | Точка преминава в `closed`                    | Само **присъстващите**                       |
| `meeting_minutes`     | Първо публикуване на протокол (`notes` от празно → текст) | Само **присъстващите**            |

> Логиката за получатели беше изрично уточнена с потребителя: за свикване → **всички**, за всичко друго → **само присъстващи**.

### Хелпър `_notify_users(uids[], kind, title, body, link, payload)`

Прави два insert-а в една транзакция: ред в `notifications` + (ако има email) ред в `notification_outbox` със subject = title и body_text = body.

### UI

- `<NotificationsProvider>` обвива приложението (`Layout.tsx`).
- `<NotificationBell>` (звънчето в sidebar/mobile header) — badge с брой непрочетени, dropdown с последните, click → mark-as-read + navigate към `link`.
- RPC `notifications_mark_all_read()` — маркира всички непрочетени на текущия user.

### Email — `ALLOW_MAILS` env

Планирано: Edge Function `mail-dispatcher` чете redove `status='pending'` от outbox-а и ги праща през Resend/SES. С env `ALLOW_MAILS`:

- `*` → праща на всички
- whitelist (`a@b.com,c@d.bg`) → само на тези
- празно → пропуска (`status='skipped'`)

> **В момента outbox редовете се натрупват, но email-и не се пращат.** Планирано за следваща итерация. Виж [§14 Известни ограничения](#14-известни-ограничения--отложено).

---

## 9. Протокол и PDF

### Поле `meetings.notes` (миграция 063)

Свободен текст. Миграция 074 пуска нотификация при първото му попълване (от празно → текст).

### Print route `/meetings/:meetingId/print`

`src/pages/MeetingPrint.tsx` — отделен компонент **извън** Layout-а (без sidebar/header), за да печата чисто.

Какво включва:

1. Шапка: заглавие, дата на провеждане, статус, дата на покана, кворум.
2. Таблица „Присъстващи“: обект, собственик (от `user_unit_links` + email), ид. ч. (%), представляван от.
3. Дневен ред: за всяка точка — заглавие, описание, % за/против/въздържал се (от присъстващите ид. части), решение „Прието/Отхвърлено“.
4. Текст на протокола.
5. Места за подписи (председател и протоколчик).

`@page A4` + `page-break-inside: avoid` за таблиците. Auto-`window.print()` 250 ms след зареждане. Бутон „Печат / PDF“ в hero отваря в нов раздел.

> **WYSIWYG редактор и автогенериране на чернова на протокол** (т. 6 от анализа) са **отложени**.

---

## 10. Структура на базата данни

### `meetings`

```sql
id                            UUID  PK  default gen_random_uuid()
title                         TEXT  NOT NULL  default ''
convening_started_at          TIMESTAMPTZ  NOT NULL
notes                         TEXT  NULL                          -- 063
status                        TEXT  NOT NULL  default 'draft'     -- 075
                              CHECK (status IN ('draft','active','closed'))
convening_notice_posted_at    TIMESTAMPTZ  NULL                   -- 075
created_at                    TIMESTAMPTZ  NOT NULL  default NOW()
updated_at                    TIMESTAMPTZ  NOT NULL  default NOW()  (trigger)
```

### `meeting_attendees`

```sql
meeting_id      UUID  REFERENCES meetings(id)  ON DELETE CASCADE
unit_id         UUID  REFERENCES units(id)     ON DELETE CASCADE
attendee_name   TEXT  NULL                        -- по избор: име на представител
PRIMARY KEY (meeting_id, unit_id)
```

### `meeting_agenda_items`

```sql
id              UUID  PK
meeting_id      UUID  REFERENCES meetings(id)  ON DELETE CASCADE
sort_order      INT   NOT NULL  default 0          -- стъпка 10 (5/15/25 за вмъкване)
title           TEXT  NOT NULL
description     TEXT  NULL
voting_status   TEXT  NOT NULL  default 'open'     -- 066: 'open' | 'closed'
created_at      TIMESTAMPTZ  default NOW()
```

### `meeting_agenda_votes` (преоформена в 065)

```sql
agenda_item_id  UUID  REFERENCES meeting_agenda_items(id)  ON DELETE CASCADE
user_id         UUID  REFERENCES auth.users(id)            ON DELETE CASCADE
vote            TEXT  CHECK (vote IN ('for','against','abstain'))
voted_at        TIMESTAMPTZ  default NOW()  (trigger)
meeting_id      UUID  REFERENCES meetings(id)  ON DELETE CASCADE  -- 072: денормализирано за Realtime filter
PRIMARY KEY (agenda_item_id, user_id)
```

### `notifications` + `notification_outbox` (074)

```sql
notifications:
  id, user_id, kind, title, body, link, payload (jsonb), read_at, created_at

notification_outbox:
  id, notification_id, user_id, email, subject, body_text,
  status ('pending'|'sent'|'failed'|'skipped'), attempts, last_error, sent_at, created_at
```

---

## 11. PostgreSQL функции и тригери

### Функции (RPC и helpers)

| Функция                                                        | Тип        | Описание                                                                |
| -------------------------------------------------------------- | ---------- | ----------------------------------------------------------------------- |
| `server_now()`                                                 | RPC        | Сървърно време (за фази на кворум).                                     |
| `is_admin()`                                                   | helper     | TRUE ако `users.role='admin'`.                                          |
| `can_vote_meeting_agenda_item(item)`                           | helper     | TRUE ако точката е `open` и потребителят е представен.                  |
| `meeting_agenda_target_owner(item, target)`                    | helper     | TRUE ако target е собственик на присъстващ обект.                       |
| `meeting_agenda_target_may_vote(item, target)`                 | helper     | + точката е `open`.                                                     |
| `meeting_agenda_vote_upsert_self(item, vote)`                  | RPC (user) | Гласуване от свое име; връща ясни грешки на български.                  |
| `meeting_agenda_vote_upsert_for_user(item, vote, target)`      | RPC (admin)| Ръчен запис за чужд собственик.                                         |
| `_notify_users(uids[], kind, title, body, link, payload)`      | helper     | Записва `notifications` + `notification_outbox` редове.                 |
| `notifications_mark_all_read()`                                | RPC (user) | Маркира всички непрочетени за текущия user; връща броя.                 |

### Тригери

| Тригер                                                  | Таблица                  | Кога         | Какво прави                                                |
| ------------------------------------------------------- | ------------------------ | ------------ | ---------------------------------------------------------- |
| `trg_meetings_updated_at`                               | `meetings`               | BEFORE UPDATE | Обновява `updated_at`.                                     |
| `trg_meetings_after_insert_notify`                      | `meetings`               | AFTER INSERT  | Нотификация „ново събрание“ — само ако `status='active'`. |
| `trg_meetings_after_status_active_notify`               | `meetings`               | AFTER UPDATE OF status | Нотификация при преход `draft → active`.          |
| `trg_meetings_after_notes_publish_notify`               | `meetings`               | AFTER UPDATE OF notes  | Нотификация при първо попълване на протокол.       |
| `trg_meeting_agenda_votes_voted_at`                     | `meeting_agenda_votes`   | BEFORE UPDATE | Обновява `voted_at`.                                       |
| `trg_meeting_agenda_votes_fill_meeting_id`              | `meeting_agenda_votes`   | BEFORE INSERT | Попълва денормализираното `meeting_id` от item-а.          |
| `trg_agenda_items_after_status_change_notify`           | `meeting_agenda_items`   | AFTER UPDATE OF voting_status | Нотификация „точка отворена/приключена“.   |

### RLS политики (накратко)

- `meetings`, `meeting_attendees`, `meeting_agenda_items`:
  - **SELECT**: всички authenticated.
  - **INSERT/UPDATE/DELETE**: само `is_admin()`.
- `meeting_agenda_votes`:
  - **SELECT**: всички authenticated (поименна прозрачност).
  - **INSERT/UPDATE/DELETE**: `(user_id = auth.uid() AND can_vote_meeting_agenda_item(item))` ИЛИ `(is_admin() AND meeting_agenda_target_may_vote(item, user_id))`.
- `notifications`:
  - **SELECT/UPDATE**: само редове с `user_id = auth.uid()`.
  - **INSERT**: само service_role (тригерите).
- `user_unit_links` (миграция 067):
  - **SELECT**: admin/viewer виждат всички; останалите — само своите.

---

## 12. Frontend архитектура

### Дърво на компонентите

```
App                                       (src/App.tsx)
└─ AuthProvider
   └─ ConfirmDialogProvider                (src/components/ConfirmDialog.tsx)
      └─ Router
         ├─ /meetings/:id/print → MeetingPrint   (отделно, без Layout)
         └─ Layout
            └─ NotificationsProvider       (src/contexts/NotificationsContext.tsx)
               └─ Outlet
                  └─ Meetings              (src/pages/Meetings.tsx)
                     └─ MeetingAgendaSection (src/components/MeetingAgendaSection.tsx)
```

### Ключови файлове

| Файл                                                    | Роля                                                                  |
| ------------------------------------------------------- | --------------------------------------------------------------------- |
| `src/pages/Meetings.tsx`                                | Списък + детайл (hero, banners, KPI кворум, присъстващи, протокол).   |
| `src/pages/MeetingPrint.tsx` + `.css`                   | Отделен print-friendly изглед.                                        |
| `src/components/MeetingAgendaSection.tsx` + `.css`      | Дневен ред: добавяне, шаблони, DnD, гласуване, агрегати, решения.     |
| `src/components/ConfirmDialog.tsx` + `.css`             | Async `useConfirm()` — заместител на `window.confirm()`.              |
| `src/components/NotificationBell.tsx` + `.css`          | Звънче в Layout-а с dropdown.                                         |
| `src/contexts/NotificationsContext.tsx`                 | Зареждане + Realtime subscription за `notifications`.                 |
| `src/lib/meetingQuorum.ts`                              | `evaluateQuorum()`, фази, повишен праг 75 %.                          |
| `src/lib/meetingVoteAggregate.ts`                       | `aggregateAgendaVotesForItem()`, `DECISION_REQUIRED_PERCENT`.         |
| `src/lib/meetingAgendaTemplates.ts`                     | 9 готови шаблона за типови точки.                                     |

### Държава (state) в `Meetings.tsx`

| State                         | Цел                                                                        |
| ----------------------------- | -------------------------------------------------------------------------- |
| `meeting`                     | Текущото събрание (от БД).                                                 |
| `draftRows`                   | Чернова на присъстващите, докато admin цъка чекбоксове.                    |
| `savedAttendeeUnitIds`        | Snapshot на запазените присъстващи — източник на истина за КВОРУМ и UI.    |
| `attendeesDirty`              | Derived: TRUE ако `draftRows` ≠ `savedAttendeeUnitIds`.                    |
| `agendaItems`, `agendaVotes`  | Дневен ред + всички гласове, синхронизирани през Realtime.                 |
| `realtimeStatus`              | `connecting` / `live` / `offline` за pill-а в hero.                        |
| `serverNow`                   | От `server_now()`, с timeTick interval за recompute на quorum.             |

### UX подобрения (т. 12)

- **`ConfirmDialog`** заменя нативните `window.confirm()` в Meetings-модула (изтриване на събрание, точка, глас; изчистване на присъстващи; промяна на статус).
- **`beforeunload` warning** при опит за затваряне на таб с непазен draft на присъстващи.
- **Dirty бадж** + disabled „Запази“ бутон когато няма промени.

### DnD (т. 5)

- Зависимости: `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities`.
- Wrapper компонент `SortableAgendaLi` с render-prop за drag handle (`<GripVertical>`).
- При drop: `arrayMove` → bulk UPDATE `sort_order = (idx+1)*10`.
- Старите ChevronUp/Down стрелки остават като a11y-fallback.

---

## 13. История на миграциите 061–075

| #   | Файл                                                  | Какво прави                                                                                |
| --- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 061 | `061_remove_editor_role.sql`                          | Премахва роля `editor` (всички → admin); `is_admin()`, `is_editor_or_admin()` псевдоним.   |
| 062 | `062_meetings.sql`                                    | Базови таблици `meetings`, `meeting_attendees` + RLS + `server_now()`.                     |
| 063 | `063_meeting_notes.sql`                               | Поле `meetings.notes` (протокол).                                                          |
| 064 | `064_meeting_agenda_votes.sql`                        | Първа версия: `meeting_agenda_items`, `meeting_agenda_votes` (по обект).                   |
| 065 | `065_meeting_agenda_votes_per_user.sql`               | Преоформя `meeting_agenda_votes` → **един глас на потребител** (вместо на обект).          |
| 066 | `066_agenda_item_voting_status.sql`                   | Поле `voting_status` (`open`/`closed`) на точка; гласове само при `open`.                  |
| 067 | `067_user_unit_links_select_building_transparency.sql`| Viewer вижда всички `user_unit_links` — нужно за агрегация на чужди гласове.               |
| 068 | `068_meeting_agenda_votes_admin_manual.sql`           | Admin може да записва глас за чужд собственик (`meeting_agenda_target_*` функции).         |
| 069 | `069_meeting_agenda_vote_upsert_rpc.sql`              | Първи RPC `meeting_agenda_vote_upsert(...)` — обединено upsert (заобикаля 403).            |
| 070 | `070_meeting_agenda_vote_rpc_fix.sql`                 | Поправки в RPC (signature/transaction).                                                    |
| 071 | `071_meeting_agenda_vote_rpc_messages.sql`            | Разделя на `*_self` и `*_for_user` + ясни грешки на български.                             |
| 072 | `072_meetings_realtime.sql`                           | Денормализира `meeting_id` в votes; `REPLICA IDENTITY FULL`; добавя в `supabase_realtime`. |
| 073 | (резервиран)                                          | —                                                                                          |
| 074 | `074_notifications.sql`                               | `notifications`, `notification_outbox`, RLS, тригери, RPC, Realtime.                       |
| 075 | `075_meeting_status.sql`                              | `meetings.status` (`draft`/`active`/`closed`) + `convening_notice_posted_at` + триггери.   |

---

## 14. Известни ограничения / отложено

### Отложено (по решение на потребителя)

- **Email dispatcher (Edge Function `mail-dispatcher`)** — outbox-ът се пълни, но писма не излизат. Нужни: Resend/SES API key, env `ALLOW_MAILS=*` или whitelist, retry логика.
- **WYSIWYG редактор за протокол + автогенериране** (т. 6 от първоначалния анализ).
- **Тайно гласуване** (`secret_ballot` на точка) — изрично потвърдено, че **няма**.
- **Vote audit trail** (история на промените на глас).
- **Делегиране на глас** (упълномощаване на друг собственик).
- **On-site QR registration** за по-бързо маркиране на присъстващи.

### Известни ограничения

- При `closed` събрание ограничението за редакция е само **в UI** — RLS остава либерален (admin може да поправя; преоткриването връща събранието в `active`).
- Realtime: при дълъг live режим има малък риск Supabase да затвори канала по неактивност; pill отива в `offline` и потребителят вижда статуса.
- Гласуването от клиент пише `meeting_id` в `meeting_agenda_votes` чрез trigger `BEFORE INSERT` (миграция 072) — не нужно явно подаване.
- KPI картата за кворум **не показва** dirty state в самата стойност (показва запазеното); dirty става видимо само на текста под нея.
- Шаблоните за точки са hard-coded (`src/lib/meetingAgendaTemplates.ts`) — няма UI за редакция от admin.

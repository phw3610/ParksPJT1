import {
  assertInternalRequest,
  createAdminClient,
  HttpError,
  isRecord,
  json,
  parseJson,
  withErrorHandling,
} from "../_shared/common.ts";
import { sendPush } from "../_shared/push.ts";

interface BatchRow {
  id: string;
  space_id: string;
  asset_count: number;
}

Deno.serve(
  withErrorHandling(async (req) => {
    if (req.method !== "POST") {
      throw new HttpError(405, "UNSUPPORTED", "POST 요청만 지원합니다.");
    }
    assertInternalRequest(req);
    const body = await parseJson(req);
    const admin = createAdminClient();

    if (body.mode === "flush") {
      const { data, error } = await admin.rpc(
        "claim_due_notification_batches",
        { p_limit: 20 },
      );
      if (error) {
        throw new HttpError(
          500,
          "UNKNOWN",
          "발송할 알림 배치를 가져오지 못했습니다.",
        );
      }
      const batches = (data ?? []) as BatchRow[];
      let sent = 0;
      for (const batch of batches) sent += await deliverBatch(admin, batch);
      return json({ ok: true, batches: batches.length, sent });
    }

    if (
      body.type !== "INSERT" || body.table !== "assets" ||
      !isRecord(body.record)
    ) {
      throw new HttpError(400, "UNKNOWN", "지원하지 않는 DB 웹훅입니다.");
    }
    const spaceId = body.record.space_id;
    if (typeof spaceId !== "string") {
      throw new HttpError(400, "UNKNOWN", "웹훅 record에 space_id가 없습니다.");
    }
    const { data, error } = await admin.rpc("enqueue_notification_batch", {
      p_space_id: spaceId,
    });
    if (error || !data) {
      throw new HttpError(500, "UNKNOWN", "알림 배치를 저장하지 못했습니다.");
    }
    return json({ ok: true, queued: true, batch: data }, 202);
  }),
);

async function deliverBatch(
  admin: ReturnType<typeof createAdminClient>,
  batch: BatchRow,
): Promise<number> {
  const { data: space, error: spaceError } = await admin
    .from("spaces")
    .select("name")
    .eq("id", batch.space_id)
    .maybeSingle();
  if (spaceError || !space) {
    await recordDeliveryError(admin, batch.id, "스페이스를 찾을 수 없습니다.");
    return 0;
  }
  const { data: members, error: memberError } = await admin
    .from("space_members")
    .select("user_id")
    .eq("space_id", batch.space_id);
  if (memberError) {
    await recordDeliveryError(admin, batch.id, memberError.message);
    return 0;
  }
  const userIds = (members ?? []).map((member) => member.user_id);
  if (userIds.length === 0) return 0;
  const { data: devices, error: deviceError } = await admin
    .from("devices")
    .select("id,push_token,platform")
    .in("user_id", userIds);
  if (deviceError) {
    await recordDeliveryError(admin, batch.id, deviceError.message);
    return 0;
  }

  const message = {
    title: space.name,
    body: `새 사진 ${batch.asset_count}장이 올라왔어요`,
    data: { type: "new_assets", spaceId: batch.space_id },
  };
  const results = await Promise.all(
    (devices ?? []).map(async (device) => ({
      device,
      result: await sendPush(
        device.platform as "ios" | "android",
        device.push_token,
        message,
      ),
    })),
  );
  const invalidIds = results.filter(({ result }) => result.removeToken).map((
    { device },
  ) => device.id);
  if (invalidIds.length > 0) {
    await admin.from("devices").delete().in("id", invalidIds);
  }
  const errors = results.flatMap((
    { result },
  ) => (result.error ? [result.error] : []));
  if (errors.length > 0) {
    await recordDeliveryError(admin, batch.id, errors.slice(0, 5).join(" | "));
  }
  return results.filter(({ result }) => result.ok).length;
}

async function recordDeliveryError(
  admin: ReturnType<typeof createAdminClient>,
  batchId: string,
  message: string,
): Promise<void> {
  await admin
    .from("notification_batches")
    .update({
      delivery_error: message.slice(0, 1000),
      updated_at: new Date().toISOString(),
    })
    .eq("id", batchId);
}

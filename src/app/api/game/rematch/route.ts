import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

type Body = { joinCode: string; playerId: string };

export async function POST(req: Request) {
  try {
    const { joinCode, playerId } = (await req.json()) as Body;

    const code = (joinCode ?? "").trim().toUpperCase();
    const pid = (playerId ?? "").trim();

    if (!code || !pid)
      return NextResponse.json(
        { error: "Missing joinCode or playerId." },
        { status: 400 }
      );

    const db = supabaseServer();

    const { data: room } = await db
      .from("rooms")
      .select("id, status")
      .eq("join_code", code)
      .single();
    if (!room)
      return NextResponse.json({ error: "Room not found." }, { status: 404 });

    const { data: host } = await db
      .from("players")
      .select("is_host")
      .eq("id", pid)
      .eq("room_id", room.id)
      .single();
    if (!host?.is_host)
      return NextResponse.json({ error: "Host only." }, { status: 403 });

    // Clear game data
    await db.from("votes").delete().eq("room_id", room.id);
    await db.from("submissions").delete().eq("room_id", room.id);
    await db.from("rounds").delete().eq("room_id", room.id);
    await db.from("scores").delete().eq("room_id", room.id);

    // Reset room + readiness
    await db
      .from("rooms")
      .update({ status: "LOBBY", ended_at: null })
      .eq("id", room.id);
    await db.from("players").update({ is_ready: false }).eq("room_id", room.id);

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unexpected server error.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

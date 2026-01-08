// src/app/api/rounds/advance/route.ts
import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

type Body = { joinCode: string; playerId: string };

export async function POST(req: Request) {
  try {
    const { joinCode, playerId } = (await req.json()) as Body;
    const code = (joinCode ?? "").trim().toUpperCase();
    const pid = (playerId ?? "").trim();

    if (!code || !pid) {
      return NextResponse.json(
        { error: "Missing joinCode or playerId." },
        { status: 400 }
      );
    }

    const db = supabaseServer();

    const { data: room } = await db
      .from("rooms")
      .select("id, status, round_seconds, total_rounds")
      .eq("join_code", code)
      .single();

    if (!room)
      return NextResponse.json({ error: "Room not found." }, { status: 404 });
    if (room.status !== "IN_GAME") return NextResponse.json({ ok: true });

    // ensure caller is an active player (prevents random internet calls)
    const { data: player } = await db
      .from("players")
      .select("id, is_active")
      .eq("id", pid)
      .eq("room_id", room.id)
      .single();

    if (!player?.is_active)
      return NextResponse.json(
        { error: "Player not active." },
        { status: 400 }
      );

    // latest round
    const { data: round } = await db
      .from("rounds")
      .select("id, round_number, phase")
      .eq("room_id", room.id)
      .order("round_number", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!round)
      return NextResponse.json(
        { error: "No round to advance." },
        { status: 400 }
      );

    // PROMPT -> GENERATING (set ends_at to now+round_seconds in SAME UPDATE)
    if (round.phase === "PROMPT") {
      const seconds = room.round_seconds ?? 45;
      const ends = new Date(Date.now() + seconds * 1000).toISOString();

      const { data: updated } = await db
        .from("rounds")
        .update({ phase: "GENERATING", phase_ends_at: ends })
        .eq("id", round.id)
        .eq("phase", "PROMPT") // ✅ idempotent guard
        .select("id, phase, phase_ends_at")
        .maybeSingle();

      // If another client already advanced it, updated will be null — that's fine.
      return NextResponse.json({ ok: true, updated });
    }

    // GENERATING -> REVEAL (clear ends_at in SAME UPDATE)
    if (round.phase === "GENERATING") {
      const { data: updated } = await db
        .from("rounds")
        .update({ phase: "REVEAL", phase_ends_at: null })
        .eq("id", round.id)
        .eq("phase", "GENERATING") // ✅ idempotent guard
        .select("id, phase, phase_ends_at")
        .maybeSingle();

      return NextResponse.json({ ok: true, updated });
    }

    // REVEAL -> RESULTS (manual host button, no timer)
    if (round.phase === "REVEAL") {
      const { data: updated } = await db
        .from("rounds")
        .update({ phase: "RESULTS", phase_ends_at: null })
        .eq("id", round.id)
        .eq("phase", "REVEAL")
        .select("id, phase")
        .maybeSingle();

      // If last round, end game
      if (round.round_number >= (room.total_rounds ?? 3)) {
        await db
          .from("rooms")
          .update({ status: "ENDED", ended_at: new Date().toISOString() })
          .eq("id", room.id);
      }

      return NextResponse.json({ ok: true, updated });
    }

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unexpected server error.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

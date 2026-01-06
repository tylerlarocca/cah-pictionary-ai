import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { pickRandomPrompt } from "@/lib/prompts";
import { generatePrompt } from "@/lib/ai/promptGenerator";

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

    // 1) Lookup room (include settings used for prompt generation + game length)
    const { data: room, error: roomErr } = await db
      .from("rooms")
      .select("id, status, max_players, is_family_friendly, total_rounds")
      .eq("join_code", code)
      .single();

    if (roomErr || !room) {
      return NextResponse.json({ error: "Room not found." }, { status: 404 });
    }
    if (room.status === "ENDED") {
      return NextResponse.json({ error: "Game has ended." }, { status: 400 });
    }

    // Optional guard: don't allow starting beyond total_rounds
    const { data: lastRound, error: lastErr } = await db
      .from("rounds")
      .select("round_number")
      .eq("room_id", room.id)
      .order("round_number", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lastErr) {
      return NextResponse.json({ error: lastErr.message }, { status: 500 });
    }

    const nextRoundNumber = (lastRound?.round_number ?? 0) + 1;

    if (nextRoundNumber > (room.total_rounds ?? 3)) {
      return NextResponse.json(
        { error: "Maximum rounds reached. Start a rematch to play again." },
        { status: 400 }
      );
    }

    // 2) Verify host
    const { data: host, error: hostErr } = await db
      .from("players")
      .select("id, is_host, is_active")
      .eq("id", pid)
      .eq("room_id", room.id)
      .single();

    if (hostErr || !host) {
      return NextResponse.json({ error: "Player not found." }, { status: 404 });
    }
    if (!host.is_active) {
      return NextResponse.json(
        { error: "Player is not active." },
        { status: 400 }
      );
    }
    if (!host.is_host) {
      return NextResponse.json(
        { error: "Only the host can start a round." },
        { status: 403 }
      );
    }

    // 3) Generate prompt (AI first, fallback to manual list)
    let prompt_text: string;
    try {
      prompt_text = await generatePrompt({
        familyFriendly: !!room.is_family_friendly,
      });
    } catch {
      prompt_text = pickRandomPrompt();
    }

    // 4) Create round in PROMPT phase with a short "prompt reveal" timer (5s)
    const phase_ends_at = new Date(Date.now() + 5_000).toISOString();

    const { data: newRound, error: roundErr } = await db
      .from("rounds")
      .insert({
        room_id: room.id,
        round_number: nextRoundNumber,
        phase: "PROMPT",
        prompt_text,
        phase_ends_at,
      })
      .select("id, round_number, phase, prompt_text, created_at, phase_ends_at")
      .single();

    if (roundErr || !newRound) {
      return NextResponse.json(
        { error: roundErr?.message ?? "Failed to create round." },
        { status: 500 }
      );
    }

    // 5) Set room status to IN_GAME (idempotent)
    const { error: updateErr } = await db
      .from("rooms")
      .update({ status: "IN_GAME" })
      .eq("id", room.id);

    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }

    // 6) Reset readiness for the new round cycle (so ready-up can be used again)
    await db.from("players").update({ is_ready: false }).eq("room_id", room.id);

    return NextResponse.json({ round: newRound });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unexpected server error.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

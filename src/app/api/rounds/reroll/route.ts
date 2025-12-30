import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { pickRandomPrompt } from "@/lib/prompts";
import { generateFamilyFriendlyPrompt } from "@/lib/ai/prompts";

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

    // room
    const { data: room, error: roomErr } = await db
      .from("rooms")
      .select("id, status")
      .eq("join_code", code)
      .single();

    if (roomErr || !room) {
      return NextResponse.json({ error: "Room not found." }, { status: 404 });
    }
    if (room.status === "ENDED") {
      return NextResponse.json({ error: "Game has ended." }, { status: 400 });
    }

    // host check
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
        { error: "Only the host can reroll the prompt." },
        { status: 403 }
      );
    }

    // latest round
    const { data: round, error: roundErr } = await db
      .from("rounds")
      .select("id, phase")
      .eq("room_id", room.id)
      .order("round_number", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (roundErr) {
      return NextResponse.json({ error: roundErr.message }, { status: 500 });
    }
    if (!round) {
      return NextResponse.json(
        { error: "No round exists yet. Start a round first." },
        { status: 400 }
      );
    }

    // Optional: only allow reroll during PROMPT
    if (round.phase !== "PROMPT") {
      return NextResponse.json(
        { error: "You can only reroll during the PROMPT phase." },
        { status: 400 }
      );
    }

    // new prompt
    let prompt_text: string;
    try {
      prompt_text = await generateFamilyFriendlyPrompt();
    } catch {
      prompt_text = pickRandomPrompt();
    }

    const { data: updated, error: updateErr } = await db
      .from("rounds")
      .update({ prompt_text })
      .eq("id", round.id)
      .select("id, round_number, phase, prompt_text, created_at")
      .single();

    if (updateErr || !updated) {
      return NextResponse.json(
        { error: updateErr?.message ?? "Failed to reroll prompt." },
        { status: 500 }
      );
    }

    return NextResponse.json({ round: updated });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unexpected server error.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

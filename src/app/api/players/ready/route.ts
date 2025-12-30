import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { pickRandomPrompt } from "@/lib/prompts";
import { generateFamilyFriendlyPrompt } from "@/lib/ai/prompts";

type Body = { joinCode: string; playerId: string; ready?: boolean };

export async function POST(req: Request) {
  try {
    const { joinCode, playerId, ready } = (await req.json()) as Body;

    const code = (joinCode ?? "").trim().toUpperCase();
    const pid = (playerId ?? "").trim();

    if (!code || !pid) {
      return NextResponse.json(
        { error: "Missing joinCode or playerId." },
        { status: 400 }
      );
    }

    const db = supabaseServer();

    // 1) Room lookup
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

    // 2) Verify player belongs to room
    const { data: player, error: playerErr } = await db
      .from("players")
      .select("id, is_ready, is_active")
      .eq("id", pid)
      .eq("room_id", room.id)
      .single();

    if (playerErr || !player) {
      return NextResponse.json({ error: "Player not found." }, { status: 404 });
    }
    if (!player.is_active) {
      return NextResponse.json(
        { error: "Player is not active." },
        { status: 400 }
      );
    }

    // 3) Set readiness (toggle if ready is omitted)
    const newReady = typeof ready === "boolean" ? ready : !player.is_ready;

    const { error: updateReadyErr } = await db
      .from("players")
      .update({ is_ready: newReady })
      .eq("id", pid);

    if (updateReadyErr) {
      return NextResponse.json(
        { error: updateReadyErr.message },
        { status: 500 }
      );
    }

    // 4) Auto-start rule:
    // If room is still in LOBBY and ALL active players are ready -> start round 1 automatically.
    // (We only auto-start in LOBBY to avoid weird behavior mid-game.)
    if (room.status === "LOBBY") {
      const { data: activePlayers, error: activeErr } = await db
        .from("players")
        .select("id, is_ready, is_active, is_host")
        .eq("room_id", room.id)
        .eq("is_active", true);

      if (activeErr) {
        return NextResponse.json({ error: activeErr.message }, { status: 500 });
      }

      const allReady =
        (activePlayers?.length ?? 0) > 0 &&
        activePlayers!.every((p) => p.is_ready);

      if (allReady) {
        // next round number
        const { data: lastRound } = await db
          .from("rounds")
          .select("round_number")
          .eq("room_id", room.id)
          .order("round_number", { ascending: false })
          .limit(1)
          .maybeSingle();

        const nextRoundNumber = (lastRound?.round_number ?? 0) + 1;

        // prompt (AI first, fallback)
        let prompt_text: string;
        try {
          prompt_text = await generateFamilyFriendlyPrompt();
        } catch {
          prompt_text = pickRandomPrompt();
        }

        // create round
        const { data: newRound, error: roundErr } = await db
          .from("rounds")
          .insert({
            room_id: room.id,
            round_number: nextRoundNumber,
            phase: "PROMPT",
            prompt_text,
          })
          .select("id, round_number, phase, prompt_text, created_at")
          .single();

        if (roundErr || !newRound) {
          return NextResponse.json(
            { error: roundErr?.message ?? "Failed to create round." },
            { status: 500 }
          );
        }

        // set room IN_GAME
        const { error: roomUpdateErr } = await db
          .from("rooms")
          .update({ status: "IN_GAME" })
          .eq("id", room.id);

        if (roomUpdateErr) {
          return NextResponse.json(
            { error: roomUpdateErr.message },
            { status: 500 }
          );
        }

        // reset readiness for next cycle
        await db
          .from("players")
          .update({ is_ready: false })
          .eq("room_id", room.id);

        return NextResponse.json({
          ok: true,
          autoStarted: true,
          round: newRound,
        });
      }
    }

    return NextResponse.json({ ok: true, autoStarted: false, ready: newReady });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unexpected server error.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

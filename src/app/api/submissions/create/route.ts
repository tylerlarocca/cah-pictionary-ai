import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

type Body = { joinCode: string; playerId: string; promptInput: string };

export async function POST(req: Request) {
  try {
    const { joinCode, playerId, promptInput } = (await req.json()) as Body;

    const code = (joinCode ?? "").trim().toUpperCase();
    const pid = (playerId ?? "").trim();
    const input = (promptInput ?? "").trim();

    if (!code || !pid)
      return NextResponse.json(
        { error: "Missing joinCode or playerId." },
        { status: 400 }
      );
    if (!input)
      return NextResponse.json(
        { error: "Prompt input required." },
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
    if (room.status !== "IN_GAME")
      return NextResponse.json({ error: "Game not active." }, { status: 400 });

    const { data: round } = await db
      .from("rounds")
      .select("id, phase")
      .eq("room_id", room.id)
      .order("round_number", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!round)
      return NextResponse.json({ error: "No active round." }, { status: 400 });
    if (round.phase !== "GENERATING") {
      return NextResponse.json(
        { error: "Submissions allowed only during GENERATING." },
        { status: 400 }
      );
    }

    const { data: sub, error } = await db
      .from("submissions")
      .upsert(
        {
          room_id: room.id,
          round_id: round.id,
          player_id: pid,
          prompt_input: input,
        },
        { onConflict: "round_id,player_id" }
      )
      .select("id")
      .single();

    if (error)
      return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ ok: true, submissionId: sub?.id });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unexpected server error.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

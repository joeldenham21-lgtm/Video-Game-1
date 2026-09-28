"""STARWAKE -- dialogue source of truth.

Every spoken line in the film lives here. voices.py records them,
timeline.py places them, and the subtitle track is generated from them.

fx keys:
  vo      -- narration / inner voice (intimate, long hall reverb)
  radio   -- ship-to-ship comms (band-limited, static bed, squelch)
  near    -- on-location dialogue (short environmental reverb)
  choir   -- Aurai voice (doubled, shimmer, cathedral reverb)
  ai      -- ship intelligence (clean, slightly synthetic)
  memory  -- the rooftop on Kessar: close, warm, a little wind
  mimic   -- Nim, the Aurai child, echoing Asha's own voice back (pitched up, shimmer)
"""

# character -> (kokoro voice, base speed, pitch shift in semitones)
CAST = {
    "ILUNE":   ("bf_emma",    0.86, -1.0),
    "ASHA":    ("af_heart",   0.94,  0.0),
    "KADE":    ("bm_george",  0.86, -2.5),
    "JAX":     ("am_michael", 1.00,  0.0),
    "SABLE":   ("af_kore",    0.98,  0.5),
    "OFFICER": ("am_echo",    0.98, -0.5),
    "FATHER":  ("am_fenrir",  0.88, -1.0),
    "YOUNG":   ("af_heart",   0.98,  4.5),   # Asha at seven
    "NIM":     ("af_heart",   0.95,  6.0),   # the Aurai child mimics Asha's voice
}

# (id, character, fx, text, speed override or None)
LINES = [
    # ---- PROLOGUE -----------------------------------------------------
    ("N1", "ILUNE", "vo", "Every star is a song.", 0.80),
    # Kessar, twenty years ago: a rooftop, a father, a child, a dying sun
    ("Y1", "YOUNG", "memory", "Papa? Why is the sun getting thin?", 0.92),
    ("F1", "FATHER", "memory", "Someone's taking it, Ash.", 0.85),
    ("Y2", "YOUNG", "memory", "Will they give it back?", 0.9),
    ("F2", "FATHER", "memory", "Here. Hum with me. My mother told me, if you sing to a star, it remembers you.", 0.84),
    ("F3", "FATHER", "memory", "Keep singing.", 0.8),
    ("N2", "ILUNE", "vo", "Some are sung for ten billion years. When the first lights woke, the dark was not empty. It was listening.", None),
    ("N3", "ILUNE", "vo", "Then came the Hollow Throne. It did not conquer worlds. It devoured the suns they turned around.", None),
    ("N4", "ILUNE", "vo", "One by one, the songs fell silent. And the cold spread between the stars.", None),

    # ---- ACT ONE: THE HOLLOW FLEET -----------------------------------
    ("H1", "OFFICER", "radio", "Harvest of Kessar complete. Stellar yield, ninety eight percent. The Starmaw is fed.", None),
    ("K1", "KADE", "radio", "The Throne endures. Chart the next light.", None),
    ("A1", "ASHA", "vo", "I was seven when they took our sun. My father told me to sing to it. So I sang. It never came back. Neither did he.", 0.88),
    ("K2", "KADE", "radio", "Commander Venn.", None),
    ("A2", "ASHA", "near", "Admiral.", None),
    ("K3", "KADE", "radio", "Our scouts have found a young star in the Veil Reach. Blue. Unclaimed. And a world beside it that... glows.", None),
    ("A3", "ASHA", "near", "Glows, sir?", None),
    ("K4", "KADE", "radio", "Take the vanguard. Be my eyes. The Starmaw follows in six hours.", None),
    ("A4", "ASHA", "near", "Understood.", None),
    ("J1", "JAX", "radio", "Six hours to scout a whole star system. He must be feeling generous.", None),
    ("A5", "ASHA", "near", "Stay on my wing, Jax. Jumping in three. Two.", None),

    # ---- ACT TWO: THE VEIL REACH --------------------------------------
    ("J2", "JAX", "radio", "Asha... are you seeing this?", 0.92),
    ("A6", "ASHA", "near", "I'm seeing it.", 0.85),
    ("A7", "ASHA", "near", "Sable. Scan the surface.", None),
    ("S1", "SABLE", "ai", "The biosphere is storing stellar energy. Estimated reserve: eleven thousand years of starlight.", None),
    ("J3", "JAX", "radio", "Kade is going to love this place.", None),
    ("A8", "ASHA", "near", "Yeah.", 0.8),
    ("A9", "ASHA", "near", "Taking her down. I want to see it with my own eyes.", None),
    ("S2", "SABLE", "ai", "Warning. Electromagnetic surge. Primary systems failing.", 1.08),
    ("A10", "ASHA", "near", "Jax, I'm hit! I'm going down!", 1.12),
    ("J4", "JAX", "radio", "Asha! Pull up! Pull up!", 1.12),

    ("A11", "ASHA", "near", "Hello?", 0.85),
    ("M1", "NIM", "mimic", "Hello?", 0.85),
    ("A11b", "ASHA", "near", "Hi.", 0.85),
    ("M2", "NIM", "mimic", "Hi.", 0.8),
    ("I1", "ILUNE", "near", "You fell from the sky, carrying the cold of a dead sun.", None),
    ("A12", "ASHA", "near", "You speak my language.", None),
    ("I2", "ILUNE", "near", "Your heart speaks it. Very loudly.", None),
    ("A13", "ASHA", "near", "Then you know what I am.", 0.9),
    ("I3", "ILUNE", "near", "I know what you were, before they made you this.", None),

    ("A21", "ASHA", "near", "Where did you hear that?", 0.86),
    ("I13", "ILUNE", "near", "In the light of your sun. It is still crossing the dark, Asha Venn. Twenty years of light, and a song inside it. A father, and a child.", 0.84),
    ("I4", "ILUNE", "near", "The great trees drink the light of Essara, and keep it. And every night, the whole world sings it back to her. She is not our sun, Asha Venn. She is our mother.", None),
    ("A14", "ASHA", "near", "They're coming for her. A ship called the Starmaw. It will drain her until she's dark. And I was sent to show them the way.", 0.9),
    ("I5", "ILUNE", "near", "Then why do you weep?", 0.84),
    ("I6", "ILUNE", "near", "Come. There is something you must hear.", None),
    ("I7", "ILUNE", "choir", "Touch the Heartseed. Listen.", 0.84),
    ("I8", "ILUNE", "choir", "The suns they take do not die. They are caged. Still singing. Still screaming.", 0.84),
    ("A15", "ASHA", "vo", "Kessar. That's my sun. That's my sun.", 0.84),
    ("I9", "ILUNE", "near", "A song can break any cage, if it is sung close enough.", None),

    # ---- ACT THREE: THE STARMAW ---------------------------------------
    ("K5", "KADE", "radio", "Commander Venn, report. Venn.", None),
    ("K6", "KADE", "radio", "Very well. Begin the harvest.", None),
    ("H2", "OFFICER", "radio", "Siphon engaged. Drawing stellar mass.", None),
    ("I10", "ILUNE", "choir", "Sing with us.", 0.8),
    ("K7", "KADE", "radio", "Venn. Whatever you think you are doing, stop. I took you in when your world went dark. You are a daughter of the Throne.", None),
    ("A16", "ASHA", "near", "No, Admiral. I'm a daughter of Kessar.", 0.9),
    ("K8", "KADE", "radio", "Then you will die like its sun. All batteries, open fire.", None),
    ("S3", "SABLE", "ai", "Hull integrity forty percent. Six interceptors on our tail.", 1.05),
    ("J5", "JAX", "radio", "You always did fly like you had somewhere better to be.", None),
    ("A17", "ASHA", "near", "Jax!", None),
    ("J6", "JAX", "radio", "Right behind you, Ash. Go! I'll hold the door!", 1.04),
    ("S4", "SABLE", "ai", "Entering the core. Temperature critical.", None),
    ("K9", "KADE", "radio", "Venn! If you breach that cage, you'll kill us all!", 1.02),
    ("A18", "ASHA", "near", "No. I'm setting them free.", 0.9),
    ("A22", "ASHA", "near", "Remember me?", 0.8),
    ("A19", "ASHA", "near", "Go home.", 0.78),

    # ---- EPILOGUE -----------------------------------------------------
    ("J7", "JAX", "radio", "Asha? Asha, come in. Asha...", 0.88),
    ("I11", "ILUNE", "vo", "She gave back what was taken. Ten thousand suns, returned to the sky. And on every world where the light came home, the dark began to listen again.", None),
    ("M3", "NIM", "mimic", "Look!", 0.9),
    ("A20", "ASHA", "radio", "Hello?", 0.85),
    ("M4", "NIM", "mimic", "Hello!", 0.9),
    ("I12", "ILUNE", "near", "Welcome home, Asha Venn.", 0.84),
]


# Hummed lines (synthesised by audio/hum.py), with their subtitle text.
HUMS = {
    "HUM1": ("FATHER", "\u266a (humming) \u266a"),
    "HUM1b": ("YOUNG", "\u266a (humming) \u266a"),
    "HUM2": ("ILUNE", "\u266a (humming the same song) \u266a"),
    "HUM3": ("ASHA", "\u266a (humming, trembling) \u266a"),
}

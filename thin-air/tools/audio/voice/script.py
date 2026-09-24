"""THIN AIR — voiced script and written documents (canon: DESIGN.md §2).

Timeline (all times local, PDT):
  Sep 28  Owen Burke stocks a walk-out depot in the Ashford Mine adit (fuel, ice gear, rope, food).
  Oct 05  Season wrap. Pickup booked for Oct 20. Big system forecast for the 8th.
  Oct 08  Storm arrives. Summer diesel gelling. Rime on everything.
  Oct 09  04:12 the summit satellite relay drops — Kestrel Station goes silent (19 days before the crash).
  Oct 10  Mara Voss breaks her leg on the verglas-glazed helipad stairs.
  Oct 11  Burke goes down for the winter diesel and the ranger-cabin radio. Oct 12 he is killed at the mine
          by the grizzly the crew call Old Grey.
  Oct 13  Elias Hale climbs to the summit relay in a lull. Oct 14 the weather returns; he dies in the lee of
          the relay hut after diagnosing the fault (water-split transceiver + dead battery).
  Oct 16  Tomas Reyes and June Park descend the Corrigan Icefall to reach the ranger cabin, taking the
          failing Iridium. Oct 17 a snow bridge collapses: Tomas breaks his leg, the Iridium is lost.
          Oct 19 Tomas dies in the ice cave; June sets off east along the moraine. (Her fate is unknown.)
  Oct 22  The generator runs dry. Mara records a message into the station's automated weather broadcast.
  Oct 27  First break in the weather in a week.
  Oct 28  Dale Morrow flies Sam Calder (relay technician) in the DHC-3 Otter C-FKTL for a ski landing on the
          Corrigan névé; induction icing, engine failure, forced landing in the valley meadow west of Loon Lake.

Speakers: mara, dale, dispatch, hale, reyes, park, burke, rescue, heli, awos. Sam never speaks: on the radio
he answers Mara with mic clicks (one = yes, two = no).

Markup for a line's "parts" (spoken by the line's speaker unless ("say", speaker, text)):
  "text"                     sentence(s)
  ("say", spk, "text")       another speaker (multi-voice scenes)
  ("pause", s)               silence
  ("click", n)               Sam keys the handheld n times (squelch bursts on Mara's side)
  ("drop", s)                signal dropout (weak transmissions)
  ("breath",)                a soft inhale before the next sentence
Each "text" may carry a pronunciation override after "|": "the névé|the nay-vay".
"""

SPEAKERS = {
	"mara": {"name": "Mara Voss"},
	"dale": {"name": "Dale Morrow"},
	"dispatch": {"name": "Terrace Dispatch"},
	"hale": {"name": "Elias Hale"},
	"reyes": {"name": "Tomas Reyes"},
	"park": {"name": "June Park"},
	"burke": {"name": "Owen Burke"},
	"rescue": {"name": "Terrace Rescue"},
	"heli": {"name": "Rescue One-Six"},
	"awos": {"name": "Kestrel Weather"},
	"sam": {"name": "Sam"},
}

# kind: cockpit | radio | radio_weak | dictaphone | in_person | awos
LINES = [
	# ============================================================================================ PROLOGUE
	{"id": "pro_01", "speaker": "dale", "kind": "cockpit", "parts": [
		"Sam, you still with me back there? That's the Aldous coming up on the right.",
		"Forty minutes to the glacier, if this holds."]},
	{"id": "pro_02", "speaker": "dale", "kind": "radio_tx", "parts": [
		"Terrace Dispatch, Otter Kilo Tango Lima, position report."]},
	{"id": "pro_03", "speaker": "dispatch", "kind": "radio", "parts": [
		"Kilo Tango Lima, Terrace Dispatch. Go ahead, Dale."]},
	{"id": "pro_04", "speaker": "dale", "kind": "radio_tx", "parts": [
		"Over the Nass headwaters at six thousand five hundred, estimating the Corrigan névé at seventeen-oh-five.|Over the Nass headwaters at six thousand five hundred, estimating the Corrigan nay-vay at seventeen oh five.",
		"Ceilings are coming down faster than the forecast said. Light snow."]},
	{"id": "pro_05", "speaker": "dispatch", "kind": "radio", "parts": [
		"Copy that. Kestrel's weather station has the col at minus fourteen, wind two-seven-zero at thirty-five, gusting fifty.|Copy that. Kestrel's weather station has the col at minus fourteen, wind two seven zero at thirty five, gusting fifty.",
		"That was twenty minutes ago."]},
	{"id": "pro_06", "speaker": "dale", "kind": "radio_tx", "parts": [
		"So their weather station's still transmitting. They've got power, anyway."]},
	{"id": "pro_07", "speaker": "dispatch", "kind": "radio", "parts": [
		"Still nothing from the crew. Northern Heli turned back twice last week.",
		"The RCMP want somebody to lay eyes on it. Your call, Dale. Nobody's going to blame you for turning around."]},
	{"id": "pro_08", "speaker": "dale", "kind": "radio_tx", "parts": [
		"I'll have a look at the icefall. If the col's socked in, I'll put down at Loon Lake and wait it out.",
		"Kilo Tango Lima."]},
	{"id": "pro_09", "speaker": "dale", "kind": "cockpit", "parts": [
		"Your relay's up on that summit, if we could see it.",
		"Nineteen days nobody's heard a word from that station. Five people."]},
	{"id": "pro_10", "speaker": "dale", "kind": "cockpit", "parts": [
		"Hear that? She's running a little rough.", ("pause", 0.6),
		"Carb ice, maybe. Carb heat's coming on. Wet snow like this, the intake packs up."]},
	{"id": "pro_11", "speaker": "dale", "kind": "cockpit", "parts": ["Come on, girl."]},
	{"id": "pro_12", "speaker": "dale", "kind": "radio_tx", "parts": [
		"Dispatch, Kilo Tango Lima. I've got some roughness. Carb heat's on, manifold pressure's still dropping.",
		"Turning back for the lake."]},
	{"id": "pro_13", "speaker": "dispatch", "kind": "radio", "parts": [
		"Kilo Tango Lima, copy rough running, turning for Loon Lake. Say souls on board and fuel."]},
	{"id": "pro_14", "speaker": "dale", "kind": "radio_tx", "parts": ["Two souls. Three hours of fuel."]},
	{"id": "pro_15", "speaker": "dale", "kind": "cockpit", "parts": [
		"Sam. Tighten your belt. All the way. Put that case under the seat."]},
	{"id": "pro_16", "speaker": "dale", "kind": "cockpit", "parts": [
		"Mixture, rich.", ("pause", 0.4), "Fuel selector, front tank.", ("pause", 0.4), "Primer.", ("pause", 0.5),
		"Mags, both."]},
	{"id": "pro_17", "speaker": "dale", "kind": "cockpit", "parts": ["Not catching.", ("pause", 0.8), "She's not catching."]},
	{"id": "pro_18", "speaker": "dale", "kind": "radio_tx", "parts": [
		"Mayday, mayday, mayday. Terrace Dispatch, Otter Kilo Tango Lima.",
		"Engine failure. Forced landing, Aldous valley, one mile west of Loon Lake. Two souls on board.",
		"ELT is armed."]},
	{"id": "pro_19", "speaker": "dispatch", "kind": "radio_weak", "parts": [
		"Kilo Tango Lima, Terrace.", ("drop", 0.5), "copy your mayday.", ("drop", 0.7),
		"one mile west of Loon.", ("drop", 1.0), "soon as the weather", ("drop", 0.8)]},
	{"id": "pro_20", "speaker": "dale", "kind": "cockpit", "parts": [
		"There's a meadow past the river. Trees at the far end.", "I'll hold her off as long as I can."]},
	{"id": "pro_21", "speaker": "dale", "kind": "cockpit", "parts": [
		"Sam. When I say, head down, arms over your head. It's going to be loud."]},
	{"id": "pro_22", "speaker": "dale", "kind": "cockpit", "parts": ["Brace. Brace. Brace."]},

	# ============================================================================================ ACT 1 — the wreck radio
	{"id": "beacon_awos", "speaker": "awos", "kind": "awos", "parts": [
		"Kestrel Station automated weather.|Kestrel Station, automated weather.",
		"Time, zero zero one zero zulu.",
		"Wind, two six zero at four two, gusting five five.",
		"Visibility, one half. Snow. Blowing snow.",
		"Temperature, minus one six.",
		"Altimeter, two niner four one.",
		"Kestrel Station automated weather."]},
	{"id": "beacon_mara", "speaker": "mara", "kind": "radio_weak", "parts": [
		"This is Kestrel Station, Aldous Range.", ("drop", 0.3), "This is Doctor Mara Voss.",
		"We have lost our satellite link. We have one injured, four missing.",
		("drop", 0.6), "Anyone receiving this, please relay to RCMP Terrace.|Anyone receiving this, please relay to R. C. M. P. Terrace.",
		"Kestrel Station, out."]},
	{"id": "beacon_live", "speaker": "mara", "kind": "radio_weak", "parts": [
		"Anyone on this frequency.", ("drop", 0.8), "I heard an engine. In the valley.", ("pause", 0.5),
		"It stopped.", ("drop", 1.1), "If you can hear me.", ("drop", 0.6),
		"the ranger cabin on Loon Lake.", ("drop", 0.9), "There's a radio in the cabin.", ("drop", 0.4),
		"Channel six.", ("drop", 1.2), "Please."]},

	# ============================================================================================ ACT 2 — first contact
	{"id": "mara_contact_1", "speaker": "mara", "kind": "radio", "parts": [
		"Kestrel Station to anyone on channel six. Kestrel to anyone.", ("click", 1), ("pause", 0.9),
		"Someone's there. I heard you key up.", "If you can hear me, key twice.", ("click", 2), ("pause", 1.2),
		"Okay.", ("pause", 0.6), "Okay. Hi.", ("breath",),
		"My name's Mara Voss. I'm at Kestrel Station, on the col under Corrigan.",
		"You were on the plane. I heard it go over, and then I heard it stop.", ("pause", 1.0),
		"We'll do this the easy way. Key once for yes, twice for no.", "Is the pilot with you?", ("click", 2),
		("pause", 2.0), "I'm sorry.", ("pause", 1.2), "Are you hurt?", ("click", 2), ("pause", 0.6),
		"Good. That's good."]},
	{"id": "mara_contact_2", "speaker": "mara", "kind": "radio", "parts": [
		"Okay. Here's where we are.", "There were five of us up here.",
		"Elias, our team lead, went up to the summit relay fifteen days ago and didn't come back.",
		"Tomas and June tried to walk out through the icefall. They should have reached that cabin in a day.",
		"Owen went down for his fuel cache.", ("pause", 0.8), "I'm the only one left up here.", ("breath",),
		"I fell on the helipad stairs two days into the storm. My leg's broken. It's splinted, but I can't walk down.",
		"The generator ran dry six days ago. I've got a propane heater and one bottle left.",
		"So I'm not going anywhere, and nobody's flying in this."]},
	{"id": "mara_contact_3", "speaker": "mara", "kind": "radio", "parts": [
		"Can I ask you something?", "They said on the last call they were sending a technician for the relay.",
		"Is that you?", ("click", 1), ("pause", 1.2), "Of course it is.", ("pause", 0.5),
		"Okay. That's actually— okay.", ("breath",),
		"The only way up here is over the Corrigan Icefall, and you can't climb that without crampons and an axe.",
		"Owen kept a depot at the old Ashford Mine, on the east flank. Ice axe, crampons, rope, and fuel for the generator.",
		"If you can get to the mine, you can get up here.",
		"Follow the lake shore east to the creek, then the old mine road up the north bank. You'll see the headframe.",
		"Take the bow from the cabin. There are bears on that side.", ("pause", 0.5),
		"Keep the radio on. I'll be listening."]},

	# ============================================================================================ ACT 2-3 guidance
	{"id": "mara_night", "speaker": "mara", "kind": "radio", "parts": [
		"It's getting dark down there. Don't travel at night if you can help it.",
		"Get a fire going and eat something. The wolves come down to the lake after dark."]},
	{"id": "mara_first_night_end", "speaker": "mara", "kind": "radio", "parts": [
		"Morning. You made it through the night.", ("pause", 0.5), "So did I. That's two of us."]},
	{"id": "mara_mine_arrive", "speaker": "mara", "kind": "radio", "parts": [
		"Can you see the headframe?", "The adit's behind the bunkhouse.",
		"Owen's depot is in the first crosscut on the left. He painted the timbers orange so nobody could miss it."]},
	{"id": "mara_mine_inside", "speaker": "mara", "kind": "radio", "parts": [
		"It's colder in there than it looks, and those timbers are ninety years old.",
		"Don't touch anything that's holding something up."]},
	{"id": "mara_owen_found", "speaker": "mara", "kind": "radio", "parts": [
		"Is it Owen?", ("click", 1), ("pause", 3.0), "Oh, Owen.", ("pause", 2.0),
		"He knew that bear. We all did. Old Grey.",
		"He'd walk right past the mine in September, fat as a barrel, and Owen would just wave at him.",
		("pause", 1.2), "Take the gear. Please.", "And then get out of there."]},
	{"id": "mara_bear_warning", "speaker": "mara", "kind": "radio", "parts": [
		"If you see him, don't run. Make yourself big, talk to him, back away slowly.",
		"If he comes anyway, the flare gun. Right at his feet."]},
	{"id": "mara_depot_found", "speaker": "mara", "kind": "radio", "parts": [
		"You've got the gear? The crampons and the axe?", ("click", 1), ("pause", 0.8),
		"And the diesel. Owen, you beautiful man.", ("pause", 0.8),
		"Right. Treeline next. Dress for it before you get there, not after."]},
	{"id": "mara_treeline", "speaker": "mara", "kind": "radio", "parts": [
		"You're above the trees now. No more firewood from here.",
		"The wind will find every gap in what you're wearing. If you made the hide coat, wear it."]},
	{"id": "mara_glacier", "speaker": "mara", "kind": "radio", "parts": [
		"Stay on the moraine as long as you can.",
		"On the glacier, watch for sags in the snow. Those are bridges over crevasses, and they don't look like anything until they go."]},
	{"id": "mara_icefall", "speaker": "mara", "kind": "radio", "parts": [
		"That's the icefall.", "It moves a metre and a half a day in summer. Less now, but it's still moving.",
		"Go early, go fast, and don't stop under the séracs.|Go early, go fast, and don't stop under the say racks.",
		("pause", 0.8), "I've spent four summers measuring that ice. I never wanted anyone to have to climb it."]},
	{"id": "mara_ice_cave", "speaker": "mara", "kind": "radio", "parts": [
		"You're at the ice cave. That's where June and Tomas would have sheltered.", "Is anyone.", ("pause", 0.6),
		"Is anyone there?", ("click", 2), ("pause", 2.5),
		"Okay.", ("pause", 1.0), "If there are recordings, bring them. Their families should hear them."]},
	{"id": "mara_altitude", "speaker": "mara", "kind": "radio", "parts": [
		"You're getting high now. Above twenty-eight hundred the air thins out fast.",
		"If you feel slow and stupid, that's not you, that's hypoxia. Rest, and breathe."]},
	{"id": "mara_station_approach", "speaker": "mara", "kind": "radio", "parts": [
		"I can see you.", ("pause", 0.8), "I can actually see you.",
		"East module, the door with the red handle. It sticks. Put your shoulder into it."]},

	# ============================================================================================ hints
	{"id": "hint_fire", "speaker": "mara", "kind": "radio", "parts": [
		"Stones in a ring, tinder in the middle, small sticks over it.",
		"Birch bark if you can find it. It burns even wet."]},
	{"id": "hint_cold", "speaker": "mara", "kind": "radio", "parts": [
		"If you're shivering, you're already behind. Out of the wind, get a fire going, get dry.",
		"In that order."]},
	{"id": "hint_water", "speaker": "mara", "kind": "radio", "parts": [
		"Don't eat the snow. It costs you more heat than it gives you back.", "Melt it. Boil it."]},
	{"id": "hint_food", "speaker": "mara", "kind": "radio", "parts": [
		"Owen used to say you can't climb on an empty stomach.",
		"There are hares in the willows along the creek. Berries on the south slopes, under the snow."]},
	{"id": "hint_shelter", "speaker": "mara", "kind": "radio", "parts": [
		"Get out of the wind and you've won half the battle. Even a lean-to against a rock face."]},
	{"id": "hint_wolves", "speaker": "mara", "kind": "radio", "parts": [
		"They're testing you. Keep the fire high and your back to something solid.",
		"Wolves don't like a fight they can't win."]},
	{"id": "hint_scanner", "speaker": "mara", "kind": "radio", "parts": [
		"That survey scanner you brought. Point it at things.",
		"It'll tell you what they're made of. Elias loved those stupid things."]},
	{"id": "hint_oxygen", "speaker": "mara", "kind": "radio", "parts": [
		"Use the bottle. Two litres a minute while you climb, four if you're struggling. Slow breaths."]},
	{"id": "hint_storm", "speaker": "mara", "kind": "radio", "parts": [
		"The barometer's falling. Whatever you're doing, find shelter before it hits.",
		"Nobody survives a night out in one of these above the trees."]},

	# ============================================================================================ ACT 5 — the station (in person)
	{"id": "mara_station_meet", "speaker": "mara", "kind": "in_person", "parts": [
		"Hi.", ("pause", 1.0), "Sorry. You're real. I've been talking to a radio for two weeks.",
		"Come in, shut the door. The heat's the only thing I've got left."]},
	{"id": "mara_generator", "speaker": "mara", "kind": "in_person", "parts": [
		"The generator shed's across the helipad.",
		"The diesel goes in the day tank. Then bleed the injector pump. The bleed screw's on top, you'll see it.",
		"Then the starter. It'll crank for a while. It's cold, and it's sulking."]},
	{"id": "mara_generator_on", "speaker": "mara", "kind": "in_person", "parts": [
		"Oh.", ("pause", 0.8), "Listen to that.", ("pause", 1.0), "Lights. Heat.",
		"The oxygen concentrator's in the lab module. It'll fill the bottles. You'll need them on the summit."]},
	{"id": "mara_relay_explain", "speaker": "mara", "kind": "in_person", "parts": [
		"Elias thought it was ice on the antenna. It wasn't.",
		"June said so the morning it went down. The link didn't fade. It just stopped.",
		"You'll need the spare transceiver module from stores, bin C-4, and a battery pack.|You'll need the spare transceiver module from stores, bin C four, and a battery pack.",
		"The lithium one on the charging rack. The old ones won't hold a charge at minus thirty."]},
	{"id": "mara_about_elias", "speaker": "mara", "kind": "in_person", "parts": [
		"Elias was my supervisor my first season here. Twenty-three summers on this glacier.",
		"He went up because he didn't want anyone else to.", ("pause", 1.0),
		"That's the kind of stupid I'd like to be, one day. Just not yet."]},
	{"id": "mara_summit_depart", "speaker": "mara", "kind": "in_person", "parts": [
		"Take two bottles. The route follows the east ridge to the relay hut. Rope in on the cornice.",
		"If the weather turns, come back.", ("pause", 0.8), "I mean it. I can't lose anyone else."]},

	# ============================================================================================ ACT 6 — summit
	{"id": "mara_summit_storm", "speaker": "mara", "kind": "radio", "parts": [
		"The barometer's dropping like a stone. You've got maybe two hours before it hits.", "Keep going."]},
	{"id": "mara_hale_found", "speaker": "mara", "kind": "radio", "parts": [
		"Is he there?", ("click", 1), ("pause", 3.5), "Okay.", ("pause", 1.5),
		"He always kept a notebook in his chest pocket. Would you bring it down?", ("pause", 1.0),
		"Thank you."]},
	{"id": "mara_relay_guide", "speaker": "mara", "kind": "radio", "parts": [
		"Two thumbscrews on the old module, then the ribbon cable. Gently.",
		"New module in until the latch clicks. Battery pack in the tray, red to red.",
		"Power switch on the side. Then wait for the green light. It takes a minute to find the satellite."]},
	{"id": "mara_relay_online", "speaker": "mara", "kind": "radio", "parts": [
		"I've got carrier.", ("pause", 0.6), "I've got a link.", ("pause", 1.0), "Stand by."]},
	{"id": "final_call", "speaker": "mara", "kind": "radio", "parts": [
		"Terrace Rescue, Terrace Rescue, this is Kestrel Station, Kestrel Station. Do you read?",
		("pause", 2.0),
		("say", "rescue", "Kestrel Station, Terrace Rescue. We read you, weak but readable. Go ahead."),
		("pause", 0.8),
		"Terrace Rescue, Kestrel. We have two survivors. One with a fractured leg, stable.",
		"The Otter out of Terrace went down in the Aldous valley on the twenty-eighth. The pilot is deceased.",
		"Four of the station crew are missing or deceased. We need evacuation from the Kestrel helipad.",
		("pause", 1.2),
		("say", "rescue", "Copy, Kestrel. Two survivors, one fractured leg. We've got a storm sitting on the range until morning."),
		("say", "rescue", "Rescue One-Six will launch at first light, weather permitting. Can you hold the night?"),
		("pause", 1.0),
		"We can hold the night.", ("pause", 0.6), "Kestrel standing by."]},
	{"id": "mara_come_home", "speaker": "mara", "kind": "radio", "parts": [
		"Come down now. Come home.", ("pause", 0.6), "Carefully."]},
	{"id": "mara_last_night", "speaker": "mara", "kind": "in_person", "parts": [
		"They'll look for June. When it clears, they'll fly the east moraine.",
		"I keep telling myself she went east.", ("pause", 1.5),
		"Get some sleep. I'll watch the heater."]},
	{"id": "rescue_dawn", "speaker": "heli", "kind": "radio", "parts": [
		"Kestrel Station, Rescue One-Six. Ten miles southwest, I have the ridge. Say winds at the pad.",
		("pause", 1.2),
		("say", "mara", "Rescue One-Six, Kestrel. Wind two-seven-zero at fifteen, gusting twenty. The pad's clear. We're coming out.|Rescue One-Six, Kestrel. Wind two seven zero at fifteen, gusting twenty. The pad's clear. We're coming out."),
		("pause", 1.0),
		"Kestrel, One-Six. I have you in sight. Two minutes."]},
	{"id": "mara_ending", "speaker": "mara", "kind": "in_person", "parts": [
		"You came up a mountain to fix a radio.", ("pause", 1.2), "Thank you, Sam."]},

	# ============================================================================================ crew logs (dictaphone)
	{"id": "log_burke_01", "speaker": "burke", "kind": "dictaphone", "parts": [
		"Burke. Twenty-eighth of September.",
		"Depot's in at the Ashford adit. First crosscut on the left, orange paint on the timbers.",
		"Four twenty-litre cans of diesel, winter blend, the good stuff. Two ice axes, two pairs of crampons, sixty metres of rope. Stove, fuel, food for four for three days.",
		"If the helicopter can't get in and we have to walk out, that's the route. Down the icefall, east to the mine, then the old road to Loon Lake.",
		"Grey's been around the mine all month. Big old boar, scar on his shoulder. He's put on a lot of weight.",
		"Leave him alone and he'll leave you alone.", "Burke out."]},
	{"id": "log_hale_01", "speaker": "hale", "kind": "dictaphone", "parts": [
		"October fifth. End of season notes, Corrigan mass balance project, Kestrel Station.",
		"Final stake readings are in. Net balance at the station stakes is minus one point four metres water equivalent.",
		"That makes it the fourth worst year in the record. Three of the other four are in the last decade.",
		"June has reset the time-lapse cameras on the icefall for the winter. Tomas is nursing the generator.",
		"Pickup is on the twentieth, weather permitting, which up here means nothing at all.",
		"There's a system coming in on the eighth. A big one. We'll batten down and wait it out, as usual.",
		"Note for next season: the guy wires on the summit relay need replacing. They sang all through September.",
		"End of notes."]},
	{"id": "log_reyes_01", "speaker": "reyes", "kind": "dictaphone", "parts": [
		"Tomas. Eighth of October. Generator log, because June says if I don't record it, I didn't do it.",
		"Day tank's at sixty percent. We're down to the last four drums in the shed, and they're summer diesel, which at minus twenty turns into lard.",
		"I've got the block heater on and heat tape on the fuel line and I'm praying to the patron saint of Kubota.",
		"Wind's picking up from the west. There's rime on the anemometer already. You can hear the mast humming.",
		"If the power goes tonight, Owen, the headlamps are in the red bin by the door. Not the blue one.",
		"The blue one is Christmas lights. Don't ask."]},
	{"id": "log_park_01", "speaker": "park", "kind": "dictaphone", "parts": [
		"June Park. October ninth, oh six hundred.",
		"We lost the relay at oh four twelve. Not a fade. A hard drop. The carrier was gone in one scan.",
		"I've power cycled the base unit twice. The station side is fine. The fault is up at the summit.",
		"Elias thinks the antenna iced up. I don't think it's the antenna. Icing would degrade the signal first. We'd have seen it coming. We had eighteen dB of margin at four o'clock.",
		"This looks like the transceiver died. Which means somebody has to go up there.",
		"Not today. Gusts are over a hundred and ten at the col.",
		"For the record, the Iridium is on charge, and it works. So we're not cut off.", ("pause", 0.6),
		"We're just quieter."]},
	{"id": "log_voss_01", "speaker": "mara", "kind": "dictaphone", "parts": [
		"Mara Voss. October tenth.", "I'm recording this because I can't write. My hands won't stop shaking.",
		"I went out at dawn to clear the rime off the pad lights and I missed the second step. Verglas. I heard it go.",
		"Owen says it's the fibula, maybe the ankle as well. He set it, and I'm told I said some things.",
		"It's splinted. I'm on the good painkillers, which is why this sounds so calm.",
		"So I'm not going anywhere.", ("pause", 0.6),
		"Elias looked at me like I'd done it on purpose. Which is fair. I'm the one who always tells everyone to be careful on those stairs."]},
	{"id": "log_burke_02", "speaker": "burke", "kind": "dictaphone", "parts": [
		"Eleventh. Weather's giving us a gap, maybe two days.",
		"I'm going down to the depot for the winter diesel, then on to the ranger cabin to call Terrace on the park radio.",
		"The Iridium's been dropping every call since the storm, and I want a real voice at the other end.",
		"Tomas, don't touch my rope. Mara, keep the leg up.",
		"Back Tuesday. If I'm not, it's because I'm sitting in the ranger cabin eating the ranger's chocolate.",
		"Burke out."]},
	{"id": "log_hale_02", "speaker": "hale", "kind": "dictaphone", "parts": [
		"Thirteenth. Owen hasn't called in, and the Iridium has given up entirely. June thinks the antenna cable cracked in the cold.",
		"The forecast gives us eight hours of calm from mid-morning. I'm going up to the relay.",
		"I know that route better than anyone left standing. Tomas is needed here. June is needed here.",
		"And Mara has told me several times that I'm a stubborn old fool. She's right. I'm going anyway.",
		"Spare antenna, tools, the small battery. Back before dark.",
		"If I'm not back before dark, nobody comes after me.", ("pause", 0.6),
		"That isn't bravery. It's arithmetic."]},
	{"id": "log_hale_03", "speaker": "hale", "kind": "dictaphone", "wind": 1.0, "parts": [
		"Elias Hale. The fourteenth, I think. Early.",
		"I'm in the lee of the relay hut. The weather came back an hour after I got here, and I've been sheltering since.",
		"It isn't the antenna. Water got into the transceiver housing, probably in the September rain, and froze, and split the board.",
		"The spare module is in stores. Bin C-4.|The spare module is in stores. Bin C four.",
		"And the battery pack up here is finished. Take the lithium pack from the charging rack. The old ones won't hold a charge in this cold.",
		"I've written it all down in the book as well.", ("pause", 1.2),
		"My hands aren't.", ("pause", 0.8), "I'm not doing very well, Mara.",
		"I'm very cold, and I'm very tired, and I know what that means.",
		"Don't let anyone come up here in weather.", ("pause", 1.0),
		"Tell my sister I was working. And that it was beautiful, before the cloud came in.", ("pause", 0.8),
		"It was. You could see all the way to the sea."]},
	{"id": "log_voss_02", "speaker": "mara", "kind": "dictaphone", "parts": [
		"Fifteenth. Elias didn't come back.",
		"The cloud came down on the summit at noon yesterday and it hasn't lifted. Owen is two days overdue.",
		"Tomas and June want to go down the icefall and walk out to the ranger cabin radio.",
		"I'd have said no. I can't say no. I can't even stand up.",
		"They'll take the Iridium and try it again from lower down.",
		"I've shown June my velocity maps. The safe line through the icefall has moved forty metres east since August.",
		"I drew it on her map.", ("pause", 0.8), "I drew it twice."]},
	{"id": "log_reyes_02", "speaker": "reyes", "kind": "dictaphone", "parts": [
		"Sixteenth, oh five thirty. Last generator note before we go.",
		"Day tank's at twenty percent. I've left it on low with the lab heaters off.",
		"Mara, you've got maybe six days if you keep the thermostat at twelve. Don't argue with me. I did the maths twice.",
		"The propane heater's by your bunk with three bottles.",
		"We're taking the Iridium, the good rope, and June's snacks, which is the real reason she's coming.",
		"We'll call from the cabin. Probably tomorrow night. Keep your handheld on channel six."]},
	{"id": "log_park_02", "speaker": "park", "kind": "dictaphone", "cave": 1.0, "parts": [
		"October seventeenth. We're in an ice cave off the east side of the icefall, about halfway down.",
		"Tomas went into a crevasse this afternoon. The bridge just went.",
		"I held him. The rope held. It took me two hours to get him out, and his left leg is broken below the knee. Badly.",
		"I've splinted it with an ice axe and a foam pad.",
		"The Iridium was in his chest pocket. It's at the bottom of that crevasse now.",
		"He keeps apologising for that. I keep telling him it doesn't matter.", ("pause", 1.0),
		"It's very blue in here. Mara would love it."]},
	{"id": "log_park_03", "speaker": "park", "kind": "dictaphone", "cave": 1.0, "parts": [
		"Nineteenth.", ("pause", 1.0), "Tomas died last night.",
		"I think it was bleeding. Inside, where I couldn't.", ("pause", 0.8), "I don't know.",
		"He was telling me about his daughter's football team, and then he just wasn't.",
		"I've covered him with the tarp.",
		"I'm going to try the east moraine at first light. It's longer, but there's no ice on it.",
		"If someone finds this before they find me, I went east.", ("pause", 0.8),
		"Tell Mara the line she drew was right. It was the bridge. Nobody could have seen that bridge."]},
	{"id": "log_voss_03", "speaker": "mara", "kind": "dictaphone", "parts": [
		"Twenty-second. The generator ran dry at four this morning. I heard it stop.",
		"I've moved everything into the east module. Sleeping bag, food, the propane heater, the radio.",
		"I've recorded a message into the weather broadcast. June showed me how in August, as a joke.",
		"It goes out every ten minutes on the aviation frequency. Nobody flies over in October. I know that.",
		"I keep the handheld on channel six anyway, in case Tomas and June made the cabin.",
		"It's been six days.", ("pause", 0.8), "The cabin's six hours."]},
	{"id": "log_voss_04", "speaker": "mara", "kind": "dictaphone", "parts": [
		"Twenty-seventh. The storm broke this afternoon, the first time in a week.",
		"I sat at the window and watched the icefall for two hours, which is what I'm paid to do. So. Not a wasted day.",
		"I'm on the last propane bottle.",
		"I've been talking to the radio at night like it's a person. I think I'll keep doing that.",
		"If a plane comes, I'll hear it. You can hear everything up here, when the wind stops."]},
]

# ------------------------------------------------------------------------------------------------ logs (journal)
# voice: line id (voiced dictaphone) or None (written). text: what the journal shows (transcript or document).
LOGS = {
	"log_burke_01": {"title": "Depot at Ashford", "author": "Owen Burke", "date": "Sep 28",
		"voice": "log_burke_01", "location_hint": "ashford_mine: depot crosscut, on the orange-painted timbers"},
	"log_hale_01": {"title": "End of Season Notes", "author": "Dr. Elias Hale", "date": "Oct 5",
		"voice": "log_hale_01", "location_hint": "kestrel_station: lab module desk"},
	"log_reyes_01": {"title": "Generator Log", "author": "Tomas Reyes", "date": "Oct 8",
		"voice": "log_reyes_01", "location_hint": "kestrel_station: generator shed workbench"},
	"log_park_01": {"title": "Relay Down", "author": "June Park", "date": "Oct 9",
		"voice": "log_park_01", "location_hint": "kestrel_station: comms rack"},
	"log_voss_01": {"title": "The Stairs", "author": "Dr. Mara Voss", "date": "Oct 10",
		"voice": "log_voss_01", "location_hint": "kestrel_station: bunk room"},
	"log_burke_02": {"title": "Going Down", "author": "Owen Burke", "date": "Oct 11",
		"voice": "log_burke_02", "location_hint": "owens_bivouac: in the bivvy bag"},
	"log_hale_02": {"title": "Arithmetic", "author": "Dr. Elias Hale", "date": "Oct 13",
		"voice": "log_hale_02", "location_hint": "kestrel_station: boot room by the door"},
	"log_hale_03": {"title": "Relay Hut", "author": "Dr. Elias Hale", "date": "Oct 14",
		"voice": "log_hale_03", "location_hint": "summit: with Hale, in the lee of the relay hut"},
	"log_voss_02": {"title": "The Line Through the Icefall", "author": "Dr. Mara Voss", "date": "Oct 15",
		"voice": "log_voss_02", "location_hint": "kestrel_station: map table"},
	"log_reyes_02": {"title": "Last Generator Note", "author": "Tomas Reyes", "date": "Oct 16",
		"voice": "log_reyes_02", "location_hint": "kestrel_station: generator shed door"},
	"log_park_02": {"title": "Ice Cave", "author": "June Park", "date": "Oct 17",
		"voice": "log_park_02", "location_hint": "ice_cave: by the sleeping mat"},
	"log_park_03": {"title": "East", "author": "June Park", "date": "Oct 19",
		"voice": "log_park_03", "location_hint": "ice_cave: at the entrance, weighted with a stone"},
	"log_voss_03": {"title": "Every Ten Minutes", "author": "Dr. Mara Voss", "date": "Oct 22",
		"voice": "log_voss_03", "location_hint": "kestrel_station: east module (Mara gives it to you)"},
	"log_voss_04": {"title": "When the Wind Stops", "author": "Dr. Mara Voss", "date": "Oct 27",
		"voice": "log_voss_04", "location_hint": "kestrel_station: east module (Mara gives it to you)"},

	# -------------------------------------------------------------------------------- written documents
	"dale_logbook": {"title": "Pilot's Log", "author": "Dale Morrow", "date": "Oct 27–28", "voice": None,
		"location_hint": "crash_site: cockpit, in the door pocket", "text":
		"PILOT'S LOG — D. MORROW — DHC-3 OTTER C-FKTL\n\n"
		"27 OCT — Terrace to Aldous: no go. Freezing level 1100 m, snow, ceilings 800 ft. Stood down. Called Kestrel's "
		"company contact again — still nothing from the station since the 9th.\n\n"
		"28 OCT — Window forecast 1400–1800. Plan: dep. Terrace 1540, direct Aldous via the Nass headwaters, ski landing "
		"on the Corrigan névé (last spring's strip) ~1705. If the col is not visible: Loon Lake, or the meadow W of the "
		"lake (good for skis, checked it in March).\n"
		"Load: 1 pax — S. Calder, relay technician. Freight 64 kg: relay test gear, survey scanner, tools, food box for "
		"Kestrel. Fuel 3 hrs.\n"
		"Carb heat EARLY. Intake packed with wet snow last January, same aircraft, same valley.\n\n"
		"Annie's birthday Saturday. Cake from Gemma's, pick up Friday. Candles this time."},
	"ranger_logbook": {"title": "Loon Lake Ranger Station Log", "author": "Ellen Tsang, Park Ranger",
		"date": "Sep 2–30", "voice": None, "location_hint": "ranger_cabin: on the desk by the radio", "text":
		"LOON LAKE RANGER STATION — DAILY LOG\n\n"
		"Sep 2 — Clear, 11°C. Wolf pack (4 adults, 1 pup) crossed the outlet at dusk heading W. Pup limping, keeping up.\n\n"
		"Sep 9 — Owen Burke and Tomas Reyes down from Kestrel for a swim (their word) and a radio check. Ch. 6 good to "
		"the col. They left with two dozen of my eggs. Owed: 2 doz. eggs.\n\n"
		"Sep 16 — Grizzly on the Ashford road, 2 km E. The big boar the station people call Old Grey — scar on the left "
		"shoulder. Feeding on a goat carcass. Posted the road closed.\n\n"
		"Sep 22 — Grey again at the mine. Very heavy, feeding hard. Told Kestrel on ch. 6. Owen says he's stocking a "
		"depot in the adit anyway. Told him that bear's been in the adit. He said so has he.\n\n"
		"Sep 30 — Closing the cabin for the season. Handheld on the charger, solar controller OK. Bow and arrows in the "
		"locker, key on the nail. Firewood stacked. Note on the table for the Kestrel crew. See you in May."},
	"ranger_note": {"title": "Note on the Table", "author": "Ellen Tsang", "date": "Sep 30", "voice": None,
		"location_hint": "ranger_cabin: table", "text":
		"Kestrel folks —\nCabin's yours if you need it. Radio's on the charger, channel 6. Bow's in the locker, key on "
		"the nail. Don't feed the jays, they'll never leave.\nStill owed: 2 doz. eggs, Owen.\n— Ellen"},
	"miner_diary_1": {"title": "Caretaker's Diary, Autumn 1934", "author": "William Harker", "date": "Oct–Nov 1934",
		"voice": None, "location_hint": "ashford_mine: collapsed bunkhouse, under the bunk", "text":
		"ASHFORD GOLD MINES LTD. — WINTER CARETAKER'S DIARY — W. HARKER\n\n"
		"Oct. 21st 1934. Last of the crew went down with the pack train today. Mr. Ashford's orders: keep the adit "
		"timbered and the pumps greased till spring. Myself and Nils Ostby to winter. Flour, beans, 40 lb. bacon, coal "
		"oil, 2 cases of powder in the powder house.\n\n"
		"Oct. 30th. First real snow. Three feet at the portal. Nils shot a goat on the bluffs. We are eating well.\n\n"
		"Nov. 12th. Clear and very cold. The glacier cracks in the night like rifle shots. Nils says it is the mountain "
		"turning over in its sleep."},
	"miner_diary_2": {"title": "Caretaker's Diary, December", "author": "William Harker", "date": "Dec 1934",
		"voice": None, "location_hint": "ashford_mine: adit, powder house door", "text":
		"Dec. 3rd 1934. A grizzly came into the bacon cache last night through the back wall of the cookhouse. A big "
		"silvertip. Nils fired at it twice in the dark and missed or did not miss, we cannot tell. Tracks go up the "
		"creek. We keep the rifle by the door now.\n\n"
		"Dec. 19th. The bear has been back. It does not sleep. Nils says a bear that is awake in December is a hungry "
		"bear, and a hungry bear is a bad neighbour. We have moved what food is left into the adit behind the powder "
		"house door.\n\n"
		"Dec. 25th. Christmas. Beans. Nils sang in Norwegian. The wind took the stovepipe off the bunkhouse at supper."},
	"miner_diary_3": {"title": "Caretaker's Diary, Last Entries", "author": "William Harker", "date": "Feb–Mar 1935",
		"voice": None, "location_hint": "ashford_mine: No. 2 drift, at the collapse", "text":
		"Feb. 8th 1935. Timbers groaning in the No. 2 drift all week. The frost is in the rock.\n\n"
		"Feb. 11th. No. 2 came down in the night. Nobody in it, thank God. The pumps are buried.\n\n"
		"Mar. 2nd. Nils went down the creek to meet the pack train and has not come back. Four days. Snowing hard.\n\n"
		"Mar. 9th. I found his snowshoe at the forks. Bear tracks. I will not write any more about it.\n\n"
		"Mar. 20th. The pack train came in today. Ashford Gold is finished, they say — the vein pinched out at 300 feet "
		"and what is left is not worth the freight. I am to close the portal and come down. I am glad. This mountain does "
		"not want us here, and it has made itself plain."},
	"burke_note": {"title": "Note in the Adit", "author": "Owen Burke", "date": "Oct 12", "voice": None,
		"location_hint": "ashford_mine: adit, near Owen", "text":
		"12 Oct, 1640.\nGrey's been in the adit. Depot torn apart, food gone, one can punctured. He's still in here "
		"somewhere, I can smell him. Can't get back to the portal without passing the crosscut. Sitting tight. Bear "
		"spray's empty.\nIf anyone reads this: three cans of diesel are still good. The ice gear's still here. Tell "
		"Mara the route's open.\n— O.B."},
	"station_whiteboard": {"title": "Station Whiteboard", "author": "Kestrel crew", "date": "Week of Oct 5",
		"voice": None, "location_hint": "kestrel_station: main module wall", "text":
		"KESTREL STATION — WEEK OF OCT 5\n"
		"PICKUP: OCT 20 — Northern Heli, AS350, 2 lifts — BAGS AT THE PAD BY 0900!!\n"
		"Kitchen: June / Mara. Generator: Tomas. Radio sked 0800 / 2000: June.\n"
		"Stakes K1–K14 — DONE. Icefall cameras reset — DONE. GPR data backed up ×2 — Elias\n"
		"Relay mast guy wires — next season (Owen)\n"
		"NOBODY WALKS THE ICEFALL ALONE. NOBODY. — O.\n"
		"(in different pen) Who ate the last of the good coffee. — T."},
	"station_fuel_log": {"title": "Generator Fuel Log", "author": "Tomas Reyes", "date": "Oct 6–22", "voice": None,
		"location_hint": "kestrel_station: generator shed, clipboard", "text":
		"GENERATOR FUEL LOG — KUBOTA 6 kW\n"
		"Oct 06 — 4 drums left (summer blend). Day tank 85%. — TR\n"
		"Oct 08 — Gelling at the filter. Heat tape on the line. 60%. — TR\n"
		"Oct 11 — Owen fetching winter diesel from the Ashford depot (4 cans). 45%. — TR\n"
		"Oct 14 — 30%. Lab heaters off. — TR\n"
		"Oct 16 — 20%. Thermostat 12°C. Mara: 6 days. — TR\n"
		"Oct 22 — (different handwriting) Empty. 04:10. — M.V."},
	"relay_diagnostics": {"title": "Relay Link Diagnostic", "author": "June Park", "date": "Oct 9", "voice": None,
		"location_hint": "kestrel_station: comms rack printer", "text":
		"KESTREL RELAY — LINK DIAGNOSTIC — 09 OCT 04:31\n"
		"LINK STATUS ........... DOWN\nLAST CARRIER .......... 04:12:07\nBASE UNIT ............. OK (self-test pass)\n"
		"UHF PATH .............. NO RESPONSE FROM REMOTE\nREMOTE BATTERY ........ NO TELEMETRY\n\n"
		"(handwritten) Not icing. Icing = gradual SNR loss and we had 18 dB margin at 04:00. This is a hard failure at "
		"the summit — transceiver or power. Spare module: stores, bin C-4. — J.P."},
	"hale_notebook": {"title": "Field Notebook, Last Page", "author": "Dr. Elias Hale", "date": "Oct 14",
		"voice": None, "location_hint": "summit: Hale's chest pocket", "text":
		"14 Oct — Relay hut, Corrigan summit.\n"
		"Transceiver housing split — ice inside. Board cracked across the RF section. Not repairable.\n"
		"Battery pack 3.1 V/cell at −24 °C. Finished.\n"
		"Needed: transceiver module (stores C-4), lithium pack (charging rack, lab). Two thumbscrews + ribbon. Latch.\n"
		"Cloud down 11:40. Sheltering in the lee of the hut.\n"
		"Too tired to try the ridge in this.\n\n"
		"M — don't let anyone come up in weather.\nE."},
}

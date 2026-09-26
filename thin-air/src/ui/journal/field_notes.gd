class_name FieldNotes
extends RefCounted
## Field-note text for survey-scanner targets (Game.flags["scanned"], Events.scan_completed ids). Exact ids
## first, then keyword matches, then a generic line — so scans added by other streams still read well.

const EXACT := {
	&"crampon_diagram": ["Crampon diagram", "Burke's sketch of a twelve-point crampon: steel frame, front points angled for ice, a heel bail and a toe strap. Enough to build a pair at a workbench from scrap steel and wire."],
	&"owen_depot": ["Burke's depot", "Owen Burke's cache in the Ashford adit. Fuel cans, ice axes, crampons, rope, a stove — the kit for walking out through the icefall. Painted orange so you could find it by headlamp."],
	&"summit_relay": ["Summit relay", "Kestrel Station's link to the outside: a mast, a dish and a transceiver in an iced-up hut at 3,452 m. The transceiver module is missing. The battery bank is dead."],
}
const KEYWORDS := [
	["otter", "de Havilland Otter", "Single-engine bush plane, built for short strips and floats. This one came down hard in the meadow: the wing root folded, the prop bent back on itself. Aluminium, wire and fabric worth salvaging."],
	["wreck", "Wreckage", "Twisted aluminium and torn fabric. Sheet metal, wire and fasteners can be salvaged with the right tools."],
	["wolf", "Grey wolf", "Canis lupus. Hunts in packs of two to four, mostly at dusk and at night. Tests before it commits: circling, feints. Afraid of fire and flares; a hurt pack breaks off."],
	["bear", "Grizzly bear", "Ursus arctos horribilis. Fattening for winter this late in October and short-tempered. Bluff charges are common — do not run. A flare or flare gun will usually turn one."],
	["grey", "Old Grey", "The big boar the station crew named. Scar on the left shoulder. Territorial around the mine."],
	["deer", "Mule deer", "Odocoileus hemionus. Big ears, a black-tipped tail. Grazes the meadow edges at dawn and dusk; bolts at the first sound."],
	["elk", "Elk", "Cervus canadensis. Late rut — bulls still bugle in the valley at night."],
	["goat", "Mountain goat", "Oreamnos americanus. Lives on ledges no predator can reach. Its winter wool is some of the warmest fibre there is."],
	["hare", "Snowshoe hare", "Lepus americanus. Already turning white for winter. Follows the same runs every day — good for snares."],
	["raven", "Common raven", "Corvus corax. Where ravens gather and call, something has died."],
	["eagle", "Golden eagle", "Aquila chrysaetos. Rides the updrafts along the ridges hunting hares and marmots."],
	["spruce", "Engelmann spruce", "Picea engelmannii. The dark, spired tree of the valley and montane forest. Resin for fire-starting, boughs for bedding."],
	["fir", "Subalpine fir", "Abies lasiocarpa. Narrow, snow-shedding crown. Resin blisters on the bark burn hot."],
	["larch", "Subalpine larch", "Larix lyallii. The only conifer that turns gold and drops its needles each autumn — the gold band just under the treeline."],
	["pine", "Whitebark pine", "Pinus albicaulis. Twisted, wind-shaped, at the edge of the trees. Nutcrackers cache its seeds."],
	["birch", "Paper birch", "Betula papyrifera. Its bark lights even when damp."],
	["lichen", "Old man's beard", "Usnea. Hangs from the conifers; bone-dry tinder."],
	["usnea", "Old man's beard", "Usnea. Hangs from the conifers; bone-dry tinder."],
	["generator", "Station generator", "Diesel generator, 30 kW. Heat, light and the oxygen concentrator all hang off it."],
	["mast", "Weather mast", "Anemometer, temperature and pressure sensors feeding the automated weather broadcast."],
	["relay", "Relay equipment", "Radio relay hardware. Iced connectors, a cracked housing."],
	["glacier", "Corrigan Glacier", "A valley glacier flowing south from the col. Crevasses open where it steepens; the icefall is where it breaks over a rock step."],
	["crevasse", "Crevasse", "A crack in the glacier where the ice is stretched. Snow bridges hide them; rope up."],
	["ice", "Glacier ice", "Dense, blue, old ice. Crampons bite; boots don't."],
	["mine", "Ashford Mine", "Gold-rush era hard-rock mine. Timbered adit, ore chutes, a headframe. Closed in the 1930s."],
	["cabin", "Cabin", "A log cabin, chinked and roofed with shakes. Someone kept it in good repair."],
	["rock", "Granodiorite", "The pale, speckled rock of the range: quartz, feldspar, hornblende. Good tool stone where it has fractured sharp."],
	["flint", "Chert", "Fine-grained silica rock. Breaks with sharp edges; strikes a spark against steel."],
	["berry", "Berries", "Late huckleberries and crowberries, frost-sweetened. Edible — in moderation."],
	["mushroom", "Mushrooms", "Some are food, some are deadly. Know which is which."],
]


static func entry(id: StringName) -> Array:
	if EXACT.has(id):
		return EXACT[id]
	var s := String(id).to_lower()
	for k in KEYWORDS:
		if s.contains(String(k[0])):
			return [String(k[1]), String(k[2])]
	return [String(id).capitalize(), "Scan logged by the survey scanner. The data will be useful at the station."]

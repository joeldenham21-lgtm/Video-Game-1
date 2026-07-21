// ============================================================================
// ELDERFALL — books.js
// The lore library: 24 readable books scattered across the vale on small
// procedural lecterns, shelves and stone slabs. Parchment reading overlay
// with page turns, a codex (X/24), skill books, The Gravedigger's
// Confession — which spawns a buried-treasure dig site — and The Ember
// Testament, which teaches the blade to any hand that holds Aldric's Ember.
//
// Owns: one merged static mesh (all book props), one optional dig-mound mesh,
// its own DOM/CSS overlay. State lives in g.flags.books (+ related flags),
// persisted wholesale by save.js. Only imports 'three' and './core.js'.
// ============================================================================
import * as THREE from 'three';
import { terrainHeight, hash2, WATER_LEVEL, POI, clamp } from './core.js';

// ---------------------------------------------------------------------------
// THE LIBRARY — 24 books. place: [x, z, kind, yaw]; y from terrainHeight.
// kind: 'lectern' | 'shelf' | 'slab'
// ---------------------------------------------------------------------------
const BOOKS = [
  {
    id: 'drakewars1',
    title: 'The Drake Wars, Vol. I',
    author: 'Edwyn of Greywatch, Loremaster',
    place: [-6, -10, 'lectern', 0.7],
    cover: [0.46, 0.12, 0.10],
    text:
`Set down in the forty-first year of the peace, that the young may know what the old cannot forget.

They came out of the north in the year of the long winter — not a horde but a weather, a red weather that walked. The first farms burned before anyone in the south knew the word "drake." We know it now.

Chroniclers argue whether there were nine of the great wyrms or eleven. The dead of Harrow Vale do not argue. In a single autumn the drakes unmade four hundred years of quiet: granaries, temples, the river towns with their painted boats — cinders, all of it, and the sky brown with smoke for a season.

What saved us was not an army. It was a line of fires. Serwyn the Elder — she was a shepherd, mind, not a soldier — reasoned that a drake hunts by surprise and hates to be seen. So the hill-folk raised towers within sight of one another, and when a drake crossed the land, beacon answered beacon faster than any wing. Greywatch is the last of that line still standing. When you pass it, traveler, bow your head. That squat grey ring of stone bought every harvest you have ever eaten.

The beacons blunted the terror. Ending it required a man with a sword, and of him — of Aldric, the farmer's son who would be called the Ember King — the second volume treats. I was old when I wrote this and older now. Read on while the light lasts.`,
  },
  {
    id: 'drakewars2',
    title: 'The Drake Wars, Vol. II',
    author: 'Edwyn of Greywatch, Loremaster',
    place: [-9.4, -7.2, 'lectern', 1.1],
    cover: [0.38, 0.09, 0.08],
    text:
`Being the second volume, concerning the Ember King and the ending of the wars.

Aldric was seventeen when a drake burned his father's steading, and he is remembered for what he did not do: he did not flee, and he did not die. He put out the fires in his neighbor's fields first. Men follow a king; they had loved the boy long before.

Of his sword the smiths still argue. It was plain work, village-forged, but at the Battle of the Cinder Fields it took a drake's throat where tempered steel had shattered, and after that night the blade would not go cold. It warmed the hand in winter. The soldiers called it the Ember, and the name climbed from the sword to the man.

Nine years of war. The chronicle of the middle campaigns I omit — Harrow Vale, the Weeping March, the winter siege below the mountain — for grief is a poor teacher of dates. Know the ending. At Drakespire, where the wyrms brooded their eggs in the warm rock, Aldric went up with forty sworn and came down carried by six. The last of the great drakes died on his blade, and the blade's fire died with his heart, or so the six all swore.

The five wardens raised the Wardstones over the passes that same year, that nothing of the old red weather should cross into the south unfelt. Aldric they laid in the barrow at Barrowdeep with the Ember on his breast, king in death who was never crowned in life.

One thing more, which I record because a chronicler must. The wardens' tally of the nest at Drakespire counted the shells of the brood. One egg was never accounted for.

Sleep well regardless. Stones stand. Beacons wait.`,
  },
  {
    id: 'aldric',
    title: 'Aldric, the Ember King',
    author: 'Keeper Ossric of the Shrine',
    place: [257, -176, 'lectern', -2.2],
    cover: [0.55, 0.34, 0.10],
    text:
`Pilgrim, you stand where he once stood. This little shrine marks the spot — so the old families insist — where Aldric knelt to drink from a spring on his last march north, and left his cloak with a beggar because, he said, the mountain would be warm enough.

The histories will give you his battles. Let a shrine-keeper give you the man. He judged disputes sitting on fences. He could not sing, and sang anyway. He carried his boyhood hayfork on campaign and told recruits it had won more wars than any sword, because it had fed the men who fought them.

They begged him to take a crown after the Cinder Fields. He asked whether a crown would fit under a helmet, and when told no, said he had his answer.

Of the Ember, his blade, I will say only this: fire did not make it holy. A thousand small mercies did, carried in one workaday hand for nine hard years. The sword sleeps with him in Barrowdeep, and it is right that it sleeps. But the old promise is spoken at this shrine each midwinter still: should the red weather come again, the Ember will not be cold.

Leave an offering if you have one. Leave the bowl alone if you haven't. He would have laughed either way — that much, every history agrees on.`,
  },
  {
    id: 'wardstones',
    title: 'On the Wardstones',
    author: 'Casilde, Fourth Warden of the Vale',
    place: [-534, -612, 'lectern', 2.4],
    cover: [0.13, 0.25, 0.33],
    text:
`A treatise, composed for those wardens who come after me. Attend; I will not write it twice.

There are five stones: Vigil, Hearth, Grief, Winter, and the Nameless. They were not carved to keep evil out. Understand this first or understand nothing. A wall keeps evil out. The stones were raised to notice — to feel what crosses the high passes as a spider feels her web — and to cry warning down the ley to every hearth in the vale.

The runes are cut in warden-script on the north faces, where the weather is cruelest. This is deliberate. A rune that has not suffered cannot recognize suffering, and it is suffering, chiefly, that comes down out of the north.

Tend them thus: sweep the snow from the crowns before midwinter. Renew the tallow in the rune-cuts at each equinox. Speak to them. I am aware how this sounds. Do it anyway. A stone that is spoken to holds its charge; a stone forgotten grows deaf, and a deaf stone goes grey.

Mark that word. Grey. The cyan light in the cuts is the ward's breath — when it dims, the fault is not in the stone but in us, for the ward drinks from the same well as all old pacts: from being remembered.

I have watched the light thin, year on year, as the wars fade from living memory. So I leave this page as my own small rune against forgetting.

When the stones go grey, look north.`,
  },
  {
    id: 'almanac',
    title: "A Shepherd's Almanac",
    author: 'M. Fen, shepherd of Emberhollow',
    place: [26, 30, 'shelf', -0.5],
    cover: [0.30, 0.38, 0.16],
    text:
`Rules for sheep, weather, and staying alive in the vale, gathered over sixty years by a woman with no patience for dying.

On weather. If Drakespire wears a hood of cloud by breakfast, it will rain by supper. If the hood comes down to the shoulders, be indoors by supper. If you can't see the mountain at all, why are you reading? Get the flock in.

On the golden hours. Dawn and dusk run long and lovely in this vale — old folk say the sky is remembering the beacon-fires. Fine to look at. Remember the wolves think so too. More lambs are lost to a beautiful sunset than to any blizzard.

On wolves. A wolf that watches from the treeline is counting, same as you. Wave your arms and swear — you want him to know you can count too. If they've had a hard winter they'll try you anyway. Keep the dog fed and your bow strung.

On Mirrormere. Water the flock at the south shore, never out toward the middle. Ask the anglers why, if you want a long evening.

On the barrow field. Never graze past the broken columns, east away by the ruins. Grass grows thick there and comes up grey-green and wrong, and sheep that eat it stand staring at the barrow mouth till you drag them off. The old dead don't want your sheep. Don't offer.

On the Wardstones. If ever you pass the circle and the cuts in the stone have gone dark — go home, count your family, and tell the elder. That's not shepherd's business. That's everyone's.`,
  },
  {
    id: 'ballad',
    title: 'The Ballad of Greywatch',
    author: 'traditional, hand unknown',
    place: [374, 512, 'lectern', -0.9],
    cover: [0.32, 0.32, 0.36],
    text:
`(As sung in the vale. The tune is older than the words; the words are older than the inn.)

Grey stone, grey stone, high on the hill,
Who keeps the watch? — I keep it still.
Wind in the arrow-slits, frost on the stair,
The vale sleeps sound for the man who's there.

Nine towers stood when the red wing flew,
Beacon to beacon the warning grew;
Eight are fallen and one remains —
Grey stone standing in the winter rains.

Hedric the Watchman, last of the line,
Kept the cold brazier for forty-nine
Winters alone, and he swore men would find
Fire in the iron though the world went blind.

They found his bones by the beacon-bowl,
His hand on the flint — God keep his soul;
No drake had come, and the fools below
Asked what he'd watched for. They didn't know.

Grey stone, grey stone, say what you saw —
Faith is the keeping, not the war.
Climb, if you doubt it. The stair is steep.
Light it, stranger, and the vale will sleep.

(This last verse is new-added, since the elder started sending folk up the hill again.)`,
  },
  {
    id: 'bestiarum1',
    title: 'Bestiarum Elderfallis, Vol. I',
    author: 'Brother Aldous, naturalist',
    place: [-30, -18, 'shelf', 1.9],
    cover: [0.42, 0.28, 0.12],
    text:
`A catalogue of the vale's common menaces, with practical annotation. Volume the First: things that are alive.

THE WOLF. Runs in packs of two and three; more in hard winters. Circles wide, tests the flank, and flees when blooded past a quarter of its vigor — the wolf is a gambler who knows when the table has gone cold. Respect the howl: it is arithmetic. He is telling his brothers where you are and how many friends you brought. Pelts fetch fair coin with the hunter Sylva, who pays better for clean kills, and says so, loudly.

THE GOBLIN. Cowardly alone, lethal in threes, and never quite where you are swinging. It zigs. Scholars dispute whether this is cunning or a total absence of forward planning; the goblin, mercifully, cannot read the debate. Fond of rocky ground, firelight, and other people's supper. Kill the loudest one first — the rest consult their courage and find it missing.

THE BANDIT. The only beast in this volume that will take your coin before your throat, which some call civilization. Blocks with skill, banters to distract, and marks travelers at a distance by the quality of their boots. The camps west of the vale fly a red plume of late. See the broadsheet on Redfang, which I annotated with the door barred.

A NOTE ON METHOD. Everything in this volume I have observed alive, from distances my colleagues called cowardly and my continued authorship calls correct.

For things no longer alive, and things that were never properly alive at all, see Volume the Second — bones, barrows, and the great wyrms. Read it sitting down.`,
  },
  {
    id: 'bestiarum2',
    title: 'Bestiarum Elderfallis, Vol. II',
    author: 'Brother Aldous, naturalist',
    place: [605, -433, 'shelf', 2.6],
    cover: [0.24, 0.16, 0.24],
    text:
`Volume the Second: things dead, undead, and worse. Herein bones, barrows, and the great wyrms.

THE SKELETON. Walks by night about the old ruins, and cares nothing for your feelings on the matter. It does not tire, bleed, or bluff, but it is brittle and stupid — the animating grudge is spread thin across too few bones, and a heavy blow scatters them. Fear the rattle, not the thing that rattles: hear it twice from two directions and you are already surrounded.

THE BARROW-LORD. Where many dead lie under one crown, one will rises to wear it. The lord of Barrowdeep was, in life, sworn shieldman to King Aldric — this is not legend; the grave-rolls survive — and in death he keeps his last order: let none take the sword. He calls his lesser dead up when pressed. I did not stay to count them.

THE DRAKE. Read the Loremaster's histories for the wars; read here for the animal. It circles before it strikes — always. Its fire runs in lines, not clouds, and ground already burning is ground it will not breathe on twice. Its hide turns every edge that men can forge. Every edge, the old soldiers insist, save one, and that one lies folded in a dead king's hands beneath Barrowdeep.

The chronicles say one egg of the Drakespire brood was never found. Shepherds say the summit has been warm these last few winters, and the snow does not lie there as it should.

I have never seen a living drake. My predecessor had. Briefly.

Volume the Third is not planned.`,
  },
  {
    id: 'diary',
    title: "A Child's Diary",
    author: 'the hand is a child’s',
    place: [610, -414, 'slab', 0.4],
    cover: [0.50, 0.42, 0.30],
    text:
`(The book was found wrapped in oilcloth, tucked into a gap in the barrow stones. The hand is a child's.)

Day one. Papa says we sleep in the old stones tonight because the sky was red over Harrow Vale. Mama said don't frighten them and Papa said look at the sky, Lise. I am not frightened. The barrow people were a king's soldiers, Papa says, so we are guests of soldiers. I left them half my bread to be polite.

Day two. Smoke all day where the vale is. Tam cried and I didn't. The soldiers under the stones don't mind us. Mama sang the Drakespire song, hush the wind and hush the pine, and everybody stopped being scared for the length of the song.

Day three. Papa walked to the ridge to look. Mama watched the barrow mouth all day. I taught Tam draughts with white pebbles and black ones. He cheats but he's four.

Day four. Papa is not back. Mama says a day means nothing, the roads are bad now. The bread is done. It rained, and the stones cried the water down their faces, and I thought: the soldiers are sad for us. And then I was frightened, finally.

Day five. A light went up on the far hill in the night. One bright point, like a star come down to see. Mama says that's the watch tower, that's men, that means it's ending. Tam is asleep. When Papa comes back I will tell him we were brave. We were

(It ends there. Nothing else is written.)`,
  },
  {
    id: 'redfang',
    title: 'Redfang: A Warning',
    author: 'a survivor',
    place: [-566, 208, 'lectern', 2.9],
    cover: [0.55, 0.16, 0.10],
    text:
`POSTED BY ORDER OF NOBODY, BECAUSE THE MAGISTRATE IS DEAD. COPIED OUT BY HONEST HANDS. READ IT AND LIVE.

Concerning VARGR, called REDFANG, who holds the camp in the western hills with a company of cutthroats.

Know him thus: a big man in a red plume, scarred, unhurried. He does not shout. Shouting, he says, is for men who are not certain, and he is always certain.

Know his customs. He takes tolls on the west road from those who can pay, and takes everything from those who can't. He keeps ledgers — a bandit who writes, gods help us — every coin owed him, every slight, every man who ran, all in a fair clerk's hand. Ask the innkeepers of three villages how collection day goes. Ask quietly.

Know this above all. A caravan guard out of the south put a sword through his shoulder two winters back and left him for finished. That guard was found. The men who hid the guard were found. Vargr Redfang does not forgive, does not forget, and does not hurry. Beat him, wound him, humiliate him — and he will study you, mend, and meet you again better prepared than you left him. The vale has buried everyone who thought once was enough.

Pay the toll or go around. And if you must fight him, friend — finish it.`,
  },
  {
    id: 'angler',
    title: 'The Angler of Mirrormere',
    author: 'set down by B., innkeep',
    place: [0, 0, 'shelf', 0], // position resolved to the lake shore at build time
    cover: [0.14, 0.30, 0.36],
    text:
`You'll hear this one at the inn told six ways. Here is the true way, which I know because Haldan told me himself, and Haldan never lied except about fish.

Sixty years Haldan fished the Mirrormere, out before dawn while the lake did its trick — you've seen it, that hour when the water goes so still it swaps places with the sky, and your boat hangs on nothing over a bowl of sinking stars. Local folk don't fish that hour. Haldan always did.

He said there was a fish in the lake that was pale all over, big as a coracle, old as the vale. He called her the Abbess, since she had taken vows never to be caught. In fifty years he hooked her four times. The fourth time she towed him shore to shore till his line sang like a fiddle string and snapped, and Haldan stood up in the boat and bowed to the water.

Folk laughed. Then one drought summer the Mirrormere dropped a fathom, and out in the middle, where nothing should stand, there was the top of an old bell tower — a whole village down there, drowned before the barrows were new. The lake had been mirroring the sky all those years, Haldan said, so that nobody would think to ask what it was hiding.

He went out one autumn dawn and didn't come back. The boat came ashore dry and tidy, line neatly wound. Drowned, says sense. But the farmer Wendel's late wife — who sang to the water of an evening from the south dock, and the water paid attention — always swore that on very still mornings there were two shapes out in the deep part, circling slow, like old friends walking.

Fish the south shore. Leave the middle alone. And if the dawn goes very still — bow.`,
  },
  {
    id: 'songs',
    title: 'Songs of Emberhollow',
    author: 'written out fair, various hands',
    place: [-18, 14, 'shelf', 0.9],
    cover: [0.50, 0.30, 0.42],
    text:
`Three songs of the village, written out fair so they won't be lost. Everyone knows the tunes. If you don't, hum; the tune will find you by the second verse. They always do, here.

THE HEARTH ROUND
(sung in a circle, each voice a line behind)
Log on the fire and latch on the door,
Boots by the hearthstone, sand on the floor,
Bread on the table and dark come down —
Nothing is wrong tonight in our town.

THE HARVEST SONG
(for the last cart home)
Swing low the scythe and bind the sheaf,
The summer's short and the year's a thief,
But the barn is full and the ale is poured —
So the year can take what we can afford!
One for the mouse and one for the crow,
One for the frost and the rest below;
Dance till the fiddler's arm gives out —
That's what a harvest is about.

HUSH THE WIND
(the Drakespire lullaby)
Hush the wind and hush the pine,
The mountain minds his own, love; you mind thine.
The fire on the peak went out long ago,
Sleep, for the beacon sleeps below.
Old wings folded, old fires done,
Nothing in the dark now, little one —
And if the dark should glow again,
Hush: the watchmen wake, and then
The vale will fill with brave tall men,
And you may sleep the sounder then.

(The last verse of the lullaby is older than the rest. Nobody remembers writing it.)`,
  },
  {
    id: 'sneaking',
    title: 'On Sneaking and Shadows',
    author: 'attributed to the Grey Cat of Dunmar',
    skill: 'shadow',
    place: [-612, 172, 'slab', -1.3],
    cover: [0.15, 0.15, 0.18],
    text:
`Attributed to the Grey Cat of Dunmar, master burglar, who was never convicted of anything and would like that noted.

First lesson. Nobody sees with their eyes. They see with their expectations. A guard does not watch a corridor; he watches for what a corridor usually is, which is empty. Be part of usually. Move when noise moves — wind, bells, arguments — and stop before it stops.

Second lesson. Crouch, but understand why. Low is not about being small; low is about being where eyes don't rest. Eyes live at head height. So do torches. The floor is a foreign country, badly patrolled. Sink, and stay sunk.

Third lesson. Slow is invisible. The eye is a hunting thing — it forgives shape, forgives shadow, forgives even torchlight on a buckle, but it leaps at speed like a cat at a string. When you think you are moving slowly enough, halve it.

Fourth lesson. Night is a tool, not a friend. Dark makes men blind and also makes them listen. Trade accordingly: in daylight, mind eyes; in darkness, mind your boots. Grass is a friend. Gravel is an informer.

Fifth lesson, dearest lesson. Know why you're there. Take the ledger, not the candlesticks. Greedy footsteps ring different — I can't explain it and I don't have to. Every soul the watch ever hanged was carrying one thing too many.

Practice in your own kitchen until the cat stops noticing you. The cat is the examiner. The cat does not grade kindly.`,
  },
  {
    id: 'primer',
    title: "The Bladesman's Primer",
    author: 'Serjeant Hewe, drillmaster (ret.)',
    skill: 'blade',
    place: [16, -20, 'lectern', -2.6],
    cover: [0.30, 0.30, 0.34],
    text:
`For recruits. Short, because in my experience so are you.

The grip. Hold the sword like a bird. Choke it and it's dead, and so are you; too slack and it flies off, likewise. Firm in the bottom two fingers, easy in the top. Everything good in swordsmanship comes out of those two fingers. Nothing good ever came out of a fist.

The feet. Fights are won below the knee. Step, don't stride; a bladesman crosses his feet once and it's the last dancing he does. When you swing, your weight goes THROUGH the cut, not trailing after it.

The light cut and the heavy. Light cuts are questions — ask them constantly. Heavy cuts are answers, and you only get to answer when the enemy asks you something stupid: a raised arm, a missed lunge. And mind — wind up early and the whole tavern knows your plans.

The block and the turn. Any coward can catch a blow on steel. The art is catching it EARLY — meet it in its cradle, in the first hand-span of its life, and it dies there, and the man behind it stumbles into your reply like a drunk down a stair. Timing, not strength. A blow met late costs you. A blow met at its birth pays YOU.

Care of the blade. Oil it, whet it, and never name it until it has saved your life twice. Once is luck.

Drill until your arms disobey you, then drill the disobedience out. That is all swordsmanship is. The rest is scars explaining themselves.`,
  },
  {
    id: 'meditations',
    title: 'Meditations on Flame',
    author: 'the sayings of Ilvane, gathered',
    skill: 'sorcery',
    place: [165, -1140, 'slab', 0.8],
    cover: [0.55, 0.24, 0.06],
    text:
`Being the sayings of the pyromancer Ilvane, gathered by her students, who mostly survived.

One. You do not throw fire. You persuade it that where you are pointing is dry. This is the whole of the art; sit with it for a year.

Two. Fire is not angry. We call it hungry, devouring, furious — bookkeeping by the burnt. Fire is honest. It is the only element that tells you exactly what it wants, always, and what it wants is everything. Respect that clarity. Imitate it when you cast.

Three. A student asked: master, why does the flame obey you and not me? Ilvane said: it does not obey me. We merely want the same thing at the same moment, and the flame cannot tell which of us is leading. This is called mastery.

Four. Warm your hands at your own spell. If you cannot — if some part of you flinches from your own fire — the flinch will live in every casting like a knot in timber. The mages of the old wars burned drakes out of the sky, and drakes are made of fire. Ask yourself what those mages had stopped being afraid of.

Five. On the last day, a student asked: master, what is fire, finally? And Ilvane held her palm over the candle until the whole room ached, and said: attention. Everything burns where attention rests too long. You have felt this. Cast from there.

Six. Keep a bucket of sand.

(gathered at the Collegium, before it burned)`,
  },
  {
    id: 'confession',
    title: "The Gravedigger's Confession",
    author: 'T.',
    special: 'grave',
    place: [632, -436, 'slab', 2.1],
    cover: [0.20, 0.13, 0.09],
    text:
`I will write it plain, because I am dying, and priests cost money, and paper forgives everything if you press hard enough.

For thirty years I dug graves for this vale and dug them honest. Whatever else is said of me, the dead of Emberhollow lie straight and deep, and I never took so much as a ring, no matter how it shone when the family wasn't looking. Thirty years. Remember that part.

Then they brought the Fourth Warden down from the stones. Casilde. You have read her treatise, maybe — a hard woman, precise. Buried with her wands of office, and with a little charm on a leather cord: a grey stone disc, a rune worn almost smooth. The family said the charm was for finding what is lost. Coin finds its way to whoever carries it, they said, the way water finds a low place. And then they buried it. Buried it! A thing like that, under six feet of honest dirt, doing nobody any good until the world ends.

I told myself I would borrow it. That was the word I used, in my own head, at midnight, with a shovel in my hands. Borrow.

The charm works. That is the horror of it. Coin has come to me these nine years like crows to a carcass — found purses, lucky cards, dead men's debts repaid to the wrong man and me not correcting the error. And every night of those nine years I dream of her, stood at the foot of my bed with soil on her shoulders, saying nothing, holding out her hand. She is patient. She was a warden. Patience was the whole trade.

I could not put it back. I could not bear to spend it, neither. So it is all under the earth again — the charm, and every coin it ever dragged home. East of the old king's shrine and a touch south, three hundred paces, where two hills fold together and the grass grows wrong over the disturbed ground.

Dig it up, stranger, and take the dream with it. Tell her I am sorry. Tell her I kept the graves straight. All but hers.`,
  },
  {
    id: 'elderwar',
    title: 'The Elder War, Chronicle of the First Dark',
    author: 'the fragments of Maelor, last scribe of the elder folk',
    place: [238, -756, 'lectern', 2.4], // roadside by the Elder Gate pass
    cover: [0.16, 0.18, 0.26],
    text:
`(What survives of the oldest chronicle in the world, rendered out of the old tongue. The elder folk wrote on stone, and stone forgets slowly; but it does forget. Where the record fails, I have marked it. — E. of Greywatch)

Before the vale, before the barrows, before any king or shepherd, the world was young and the north was low. Walk far enough in those days and you came at last to level country under an open sky, and the dawn ran across it like water. So the fragments say, and I believe them, for someone remembers it still — ask any old wife of Emberhollow why the light lingers so long and gold here, and she will tell you the sky is remembering. It is.

Then came the First Dark. It was not an army. The stones are very clear on this, clearer than I could wish. It did not march and it did not burn. It rose. Wells went bitter first; then the birds forgot their songs; then names — whole villages forgot their own names — and then the elder folk understood that something beneath the world had turned toward them, and the Elder War began.

How does one fight the cellar of the world? The fragments count seventy years of it. I will not write what stands in the middle fragments; I tried once, and my hand [text lost]. Know only that the elder folk won, insofar as anyone did. They could not slay the Dark. So they buried it.

All the nations of that morning carried stone into the north. Mountains were heaped upon mountains at the top of the world, higher than any need of nature — you have seen them, past Drakespire, the great white teeth beyond every map ever drawn. The elder folk raised them so high that dawn touches those peaks before it touches anything else alive, and they named them the Wall of Morning: that whatever lies beneath should lie furthest of all made things from the light, and be reminded of it, every morning, forever.

The raising spent them. That is the whole meaning of the old word ELDERFALL, which men now put on maps without a shiver. Their last work was a rampart of gates and watch-stones across the passes. One arch of it stands yet — the Elder Gate, under which you likely read this — and one stone of their setting stands among our five in the west, the one the wardens do not name.

The Dark was not slain. I set it down once more, plainly, as a chronicler must. It was buried, and burial is a patience, not an ending. Read the wardens' books after this, if you would sleep less soundly, and better informed.`,
  },
  {
    id: 'titanbook',
    title: 'Of the Titan',
    author: 'Edwyn of Greywatch, Loremaster',
    place: [-152, 310, 'slab', -0.6], // south vale, off the Titan's plinth
    cover: [0.36, 0.33, 0.28],
    text:
`Being a note appended in my last years to the Chronicle of the Drake Wars, concerning the great figure that stands over the south vale, which the shepherds call the Titan, and do not graze beneath.

Set aside, first, what the masons will tell you. They say it is elder-work, a monument of the old world, and they say it with confidence, at a distance. Go and stand at the foot. There is not a chisel mark on him from crown to heel. The cloak has a mended tear in it. He wears a soldier's boots, twice resoled — I climbed the plinth to look, and came down quieter than I went up. Monuments are made. This man was worn.

The old families of the south vale keep the other account, and keep it stubbornly. He was called Harn, they say, a gate-ward of the old line, in the years when the watch on the north was let lapse — for peace makes forgetters of us all. When they disbanded his order, he refused the order. He took up his post on the last hill of the south vale, whence a man can see the whole road from the Elder Gate down to Emberhollow, and he swore the ward-oath alone, on a chip of wardstone he carried: I will keep the watch until morning comes to the vale floor.

An oath is a small thing in a warm mouth. It is another thing said alone, entire, with the stones listening. He stood his watch. He stood it past his strength, past his years, past — the families insist — his death, for the vow would not let the body go. Stone came up over his boots like slow water, and there he stands yet, facing north; and I note that all deliberate things in this country face north, and were set so on purpose.

Now the matter I hesitated thirty years to write. The grave-rolls of the south vale record that Harn had a son, who farmed in the shadow of the standing man; and that farmer's line runs down, name by unremarkable name, to a steading burned by drakes in the year of the long winter, and to a boy of seventeen who did not flee and did not die.

I make no claim. Chroniclers who claim outlive their credit. But if the rolls run true, then Aldric the Ember King had his standing from a grandsire who never learned to do anything else; and when the pilgrims at the shrine say the king's blade is only sleeping, I think of the old man on the hill who has not once, in all the long years, sat down.`,
  },
  {
    id: 'binding',
    title: 'The Binding of the Wardstones',
    author: 'warden-script, unsigned',
    place: [-552, -628, 'slab', 1.7], // within the Wardstones circle, southwest
    cover: [0.10, 0.20, 0.24],
    text:
`(The leaves were found rolled in lead, in the hollow beneath the Nameless stone. The warden-script is of the oldest cutting. No warden now living will say who set them there, and Casilde's treatise does not mention them. Draw what conclusion you must.)

You have read the fourth warden. She wrote well, and what she wrote is true, and it is the second truth. The stones notice; the stones cry warning; the web feels what crosses the high passes. All true. A door also has a handle. That is not what a door is for.

Hear now the first truth, which is told to each warden once, on the night the office passes, in a whisper, under the open sky, and never twice. Four of the stones watch. The fifth does not watch. The fifth leans.

Vigil, Hearth, Grief and Winter were raised by the five wardens in the year after the wars, and they look north, and north is a direction. The Nameless was raised by no warden and by no man. It was old when the passes were young; it is a sister to the far white peaks, and quarried by the same spent hands. It does not look anywhere, for what it minds is not in a direction. It is beneath. It presses, as a thumb presses a latch, and it has pressed so since the elder folk set it, and the four younger stones stand about it the way men stand about a laboring beast — to be of use, and to be near, and because one does not like to leave it alone.

Of the weight beneath I will write nothing that gives it shape, for it listens best to descriptions of itself. Know only this much. The barrows of the east were dug where they were dug because the ground there was already deep beyond any spade's report; and the honored dead were laid over that deepness in ranks, king and shieldman together, as sandbags are laid upon a dyke. Ask the shepherds why the grass grows strange on the barrow field. Ask why the sheep stand staring at the barrow mouth until they are dragged away. A flock knows a door when it grazes on one.

Your duties, then, beyond the fourth warden's list. Never let all five stones go grey in one season. Speak to the Nameless last, and briefly, and never kindly — pity has loosened more latches than hate ever did. And when the light in the cuts runs thin, do not only look north, as good Casilde bade you. She was kind. Looking north will at least keep your eyes off the ground.

But it is not the passes that keep me from sleeping.`,
  },
  {
    id: 'palerider',
    title: 'The Pale Rider',
    author: "told at the Ember's Rest; set down by B., innkeep",
    place: [12.5, 15.5, 'shelf', -2.2], // the inn's outdoor shelf, by the sign
    cover: [0.55, 0.52, 0.46],
    text:
`There's a story we only tell with the fire built up and the door on the latch, and folk complain if a winter goes by without it. You'll want the ale for this one. Here it is as I had it, and I had it true.

There is a rider on the roads of this vale that no horse in any stable ever foaled. Pale, they say — pale horse, pale cloak, and under the hood a face nobody has stood close enough to bring home. He does not hail you. He does not hurry. He is simply on the road, at dusk, at the edge of naming distance, and he is always facing this way.

My great-grandmother saw him first — first that we know of. A girl then, drawing water at Stonebridge of an autumn evening, in the quiet years before the Drake Wars. A rider on the far hill, she said, standing in the road where no road went. She fetched her mother, who looked a long while, and said nothing, and counted the milestones with her eyes. He stood at the third milestone. And he was closer.

My father's generation saw him next. Old Wendel's uncle it was, carting home in the year of the long winter — and mark well what came out of the north the autumn after. The cart passed a pale rider stopped stone-still on the west road. The ox would not turn its head. There was no sound of hooves, no breath, no creak of leather; and when a lantern was held up, the light seemed to lose interest. He stood at the first milestone. And he was closer.

The third sighting was last autumn. I'll not name the man; he drinks here still, and his hand has not steadied. Dusk, on the vale road, this side of the bridge — between the milestone and the well, friends, which is to say past the milestones altogether. Horse and rider, still as the Titan, facing Emberhollow. The man stood a long time, he says, because his legs would not take instruction. And he was closer.

Now, before you sleep badly. My grandmother, who feared nothing on legs or off them, always said the old word for him was never "death". The old word was "herald". He has harmed no living soul. He is only arriving, at his own pace, ahead of something — the way gulls come inland ahead of weather.

That's the story. Whose round is it?`,
  },
  {
    id: 'harrowsongs',
    title: 'Songs from the Harrow Fen',
    author: 'the elegies of the fen, gathered from many mouths',
    place: [-112, -312, 'slab', 0.9], // by the burial mound on Harrow Fen
    cover: [0.20, 0.30, 0.20],
    text:
`(In the Drake Wars there was a battle in the low wet country west of the vale, where the beacon-line could not see and help came a day too late. Edwyn's chronicle gives it two lines. The fen people gave it these, and sing them still, low, at the year's turning. The mound holds four hundred under one green roof.)

THE CALLING
Who lies in the fen? Say their names over water,
For water remembers what chronicle won't:
The reed and the rush hold the son and the daughter,
The names go down sweetly. The forgetting don't.

THE STAND
They stood in the mist where no beacon could find them,
Between the red weather and everything green;
No wall at their backs and no morning behind them,
And none to bear word what that standing would mean.
The fires went over. The waters closed after.
The vale never heard, and the vale slept sound —
O all you who sleep in the warmth and the laughter,
Your suppers were laid upon Harrow Fen ground.

THE MOUND
Raise it green, raise it low,
Where the grey herons go;
No stone for a roof but the rain and the plover,
No horn at the door but the wind in the sedge —
Sleep, for the war and the weather are over,
Sleep, for the beacons still burn at the edge.

THE LAST VERSE
(added later, in another hand)
Where now is the shield-arm, and where is the shieldman?
The mist on the water has taken them in.
But ask on a still night, alone on the fen-land,
And up through the water they answer as one:
We hold. We hold. We hold.

(Do not sing the last verse out on the fen itself. This is not superstition. It is manners.)`,
  },
  {
    id: 'brood',
    title: 'The Brood in the Pines',
    author: 'the journal of Garrick, hunter',
    place: [-296, -468, 'slab', -2.4], // the dark pinewood's edge, west of the vale
    cover: [0.10, 0.16, 0.12],
    text:
`(The pages that follow were found weighted under a stone at the edge of the dark pinewood, wrapped in oilskin against the wet. Garrick hunted these hills for forty years, and taught the hunter Sylva her bow. His hand starts steady.)

First day. Deer gone from the west pines. Not thinned — gone, the whole wood swept clean, and no wolf sign, and that is wrong twice over, because the wolves are gone too. Found silk in the high branches, thirty feet up. Not cobweb. Rope. Told Sylva to mind the west wood and to sell my pelts if I am long. She minds nothing, that girl. Good girl.

Second day. Followed the silk lines all morning. They all run one way, deeper in. A hunter follows sign — that is the whole trade — but I have never in forty years had sign LEAD me before. Killed one at noon. Big as a dog. Where its eyes should stop, they don't.

Third day. Found the den mouth under the split rocks. Bigger than I said aloud. Bigger than I want to write down. Old bones at the door — deer, boar, and one kind I won't name. This is no mother grown big on easy hunting. This is a brood.

Fourth day. Should have gone back for Sylva and a dozen bows.

Went in.

Webs behind me now.

Two more of the dog-sized. The quiet ones are bigger. You hear the small ones. You don't hear the big ones. That is how you know.

Torch low.

Down is warmer. It shouldn't be.

They wait for the torch.

Pines are quiet.

So quiet.

(Nothing further is written. Nothing further was found.)`,
  },
  {
    id: 'wallmorning',
    title: 'On the Wall of Morning',
    author: 'the last notebook of Vane, cartographer',
    place: [388, 527, 'shelf', -0.4], // at the foot of Greywatch Tower
    cover: [0.48, 0.40, 0.24],
    text:
`(Bought out of Fenwick's pack for two coppers, and shelved here at Greywatch, whence the far peaks can be seen on a clear day. Fenwick does not remember taking it in trade — which he says of nothing else in that pack — and he will not buy it back.)

Day 1. A commission from the Collegium, gods rest its ashes, and thirty years of survey behind me: fix the height and line of the outer peaks, the range beyond Drakespire that the vale-folk call the Wall of Morning. A peasant name. Fine peaks, freak weather, nothing a theodolite and a steady walker cannot reduce to ink. I have mapped four kingdoms. Mountains do not embarrass me.

Day 4. First anomaly. Triangulated the great summit from the Greywatch hill, and again from the Drakespire shoulder. The two answers disagree, and the disagreement is not error, because I do not make errors of four hundred feet. Remeasured at dusk. The Wall is taller at dusk. I have checked the instruments. The instruments are fine. I record this because a surveyor records.

Day 7. Marched due north from my last cairn, six hours, compass true the whole way, fair pace on open ground. The peaks are no nearer. Worse: at the fifth hour I passed my own cairn again, from the south side. I have walked a straight line asleep, drunk, and once under arrow-fire. I do not walk circles. The ground walks them for me.

Day 9. I understand it now, and have written to no one. The dawn comes to those summits a full hour before the geometry of any honest sun allows. I have timed it three mornings running. The light there does not behave. It is DELIVERED. The Wall does not catch the morning — the morning is carried up to it, first of all created things, deliberately, the way a jailer carries a lamp along a cellar stair. Not to comfort the prisoner. To count him.

Day 10. The peaks are not being measured. They are being watched. They have been watched so long and so hard that watching is what they are made of, and my little brass angles are an impertinence — like surveying the lid of a coffin during the funeral. The height of the Wall of Morning is: ENOUGH. Write that in the margin of every map I ever drew.

Day 11. North again regardless. A cartographer finishes the sheet. If the ground turns me, I will map the turning. If the light is a lamp, I will find what it is shown t

(The writing stops on the stroke. The remaining leaves are blank, save the last — where a different and far older hand has ruled a single line, perfectly straight, east to west.)`,
  },
  {
    id: 'embertestament',
    title: 'The Ember Testament',
    author: "the hand is the king's",
    special: 'ember',
    place: [617.3, -438.3, 'slab', 0.5], // inside the Barrowdeep crypt chamber
    cover: [0.30, 0.10, 0.06],
    text:
`(Sealed in wax beneath the coffin-boards at Barrowdeep, though the wardens who laid the king down swore there was nothing under the boards but stone. Judge the writing yourself. It is a plain hand, a farmer's hand, and it shakes only at the end.)

They tell me I am dying, in the gentle sideways way of soldiers, and I have sent them out for air and honesty. Six days since Drakespire. The wound will not close. Very well. I was a farmer before I was ever a spear-point, and a farmer knows the season's end without being told twice.

Set down, then, what I never said in council, because councils leak like hay-barns.

First, of my sword. They say the blade drank a drake's fire at the Cinder Fields and never went cold after. It is a good story and I let it live, because the truth frightened me more. The blade was warm BEFORE the Cinder Fields. It took its warmth the year I first marched north, the day we passed in the rain beneath the old stone man of the south vale — my own folk's hill, though I told no one that either. I felt it go warm at my hip like a coal handed down; and I looked up at the standing grandsire of my line, if the old wives have it right, and his face was wet with the rain, and I will say it here, being past mockery: it did not look like rain.

Second, of the drakes. Nine years I fought them, and somewhere in the middle years I stopped hating them, for by then I had seen how they fight. Men fight for hunger, or fear, or gold. The drakes fought like things with a door at their backs. They came south over the Wall of Morning, out of the far cold peaks where nothing feeds, and no living thing crosses that country southward unless something beneath it has turned over in its sleep. Mark me, you who read. We did not break an invasion. We broke a flight. And what a flying terror flees, I never met in nine years of war, and have prayed nightly I never would; and my prayers have the smell about them of a man asking the frost to spare one field.

So, third, my testament, and the reason for the wax and the hiding. Lay me at Barrowdeep, over the deep places, where the old dead lie ranked like sandbags on a dyke — the wardens know the truth of that ground; ask them nothing. Lay the Ember on my breast, and let the story say it sleeps. It does not sleep. A warm blade over the deep dark is a small lamp in a vast cellar, and small lamps have kept great houses standing before now. While it lies warm above, the weight beneath dreams of morning; and a thing that dreams of morning does not rise. That is the whole of my statecraft, and I had it from keeping a night-candle for my children.

Last. If you have lifted the blade — and you have, or this seal is broken for nothing — then one of two things is true. Either you are a grave-thief, in which case put it back, child; the cold you feel is not the stone. Or the wardstones have gone grey and the vale has need, in which case: the Ember remembers every hand it ever served and every cut that nine years taught it, and it will teach your arm in its turn. Stand the way my grandsire stands. Meet the blow at its birth, and swing through — weight and heart together, as the drillmasters bark. It is only a farmer's sword. It has only ever had to be.

The light is going long and gold out there, the way it does in this vale, the way it does nowhere else in the world.

Good. Let the mountains keep the morning.

I kept the evenings.`,
  },
];

const BOOK_COUNT = BOOKS.length; // 24
const DIG_POS = { x: 430, z: -80 };
const SKILL_XP = 120;

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------
export function createBooks(g) {
  const ev = g.events;
  const notify = (text, sub) => ev.emit('notify', { text, sub });
  const sfx = (name) => { if (g.audio && g.audio.play) g.audio.play(name); };

  // flags accessor — save.js may replace g.flags wholesale on load, so never
  // cache the books object; always go through this.
  const readFlags = () => (g.flags.books || (g.flags.books = {}));

  // -------------------------------------------------------------------------
  // Placement safety: some POIs (the shrine, Redfang camp) sit on terrain
  // below WATER_LEVEL in the core heightfield. Every book site is resolved to
  // the nearest dry ground via a deterministic outward spiral — a no-op for
  // spots that are already dry.
  // -------------------------------------------------------------------------
  function resolveDry(x, z) {
    if (terrainHeight(x, z) > WATER_LEVEL + 1.0) return [x, z];
    for (let d = 4; d <= 300; d += 4) {
      for (let a = 0; a < 24; a++) {
        const ang = a * (Math.PI / 12);
        const nx = x + Math.cos(ang) * d, nz = z + Math.sin(ang) * d;
        if (terrainHeight(nx, nz) > WATER_LEVEL + 1.0) return [nx, nz];
      }
    }
    return [x, z]; // give up gracefully (never happens with current terrain)
  }

  // -------------------------------------------------------------------------
  // Resolve the Angler's shelf to the Mirrormere shore (deterministic scan
  // from the lake center toward the village until we're above the water).
  // -------------------------------------------------------------------------
  {
    const lake = POI.lake;
    const dirX = (0 - lake.x), dirZ = (0 - lake.z);
    const dl = Math.hypot(dirX, dirZ) || 1;
    const nx = dirX / dl, nz = dirZ / dl;
    let sx = lake.x + nx * 260, sz = lake.z + nz * 260; // fallback
    for (let d = 40; d <= 340; d += 5) {
      const x = lake.x + nx * d, z = lake.z + nz * d;
      if (terrainHeight(x, z) > WATER_LEVEL + 0.9) { sx = x + nx * 3; sz = z + nz * 3; break; }
    }
    const angler = BOOKS.find((b) => b.id === 'angler');
    angler.place[0] = sx;
    angler.place[1] = sz;
    angler.place[3] = Math.atan2(nx, nz) + Math.PI; // shelf faces the water
  }

  // ==========================================================================
  // GEOMETRY — one merged static mesh for every prop + book in the world.
  // Manual box-merging (no addons): flat normals, per-face shade jitter,
  // vertex colors, one MeshLambertMaterial.
  // ==========================================================================
  const arrs = { pos: [], nrm: [], col: [] };

  // Push an axis-box rotated (tilt about X, then yaw about Y) and translated.
  function pushBox(A, cx, cy, cz, w, h, d, yaw, tilt, col, seed) {
    const hw = w / 2, hh = h / 2, hd = d / 2;
    const ct = Math.cos(tilt), st = Math.sin(tilt);
    const cy2 = Math.cos(yaw), sy2 = Math.sin(yaw);
    // 8 local corners → world
    const px = [], py = [], pz = [];
    for (let i = 0; i < 8; i++) {
      // corners: 0(-,-,-) 1(+,-,-) 2(+,+,-) 3(-,+,-) 4(-,-,+) 5(+,-,+) 6(+,+,+) 7(-,+,+)
      const lx = (i === 1 || i === 2 || i === 5 || i === 6) ? hw : -hw;
      const lyRaw = (i === 2 || i === 3 || i === 6 || i === 7) ? hh : -hh;
      const lzRaw = (i >= 4) ? hd : -hd;
      const ly = lyRaw * ct - lzRaw * st;       // tilt about X
      const lz = lyRaw * st + lzRaw * ct;
      px[i] = cx + lx * cy2 + lz * sy2;          // yaw about Y
      py[i] = cy + ly;
      pz[i] = cz - lx * sy2 + lz * cy2;
    }
    // faces as outward-wound quads
    const faces = [
      [4, 5, 6, 7], [1, 0, 3, 2], [5, 1, 2, 6], [0, 4, 7, 3], [3, 7, 6, 2], [0, 1, 5, 4],
    ];
    for (let f = 0; f < 6; f++) {
      const q = faces[f];
      const ax = px[q[1]] - px[q[0]], ay = py[q[1]] - py[q[0]], az = pz[q[1]] - pz[q[0]];
      const bx = px[q[3]] - px[q[0]], by = py[q[3]] - py[q[0]], bz = pz[q[3]] - pz[q[0]];
      let fx = ay * bz - az * by, fy = az * bx - ax * bz, fz = ax * by - ay * bx;
      const fl = Math.hypot(fx, fy, fz) || 1;
      fx /= fl; fy /= fl; fz /= fl;
      const s = 0.88 + 0.2 * hash2(seed * 13 + f, f * 7 + 3, 911);
      const r = clamp(col[0] * s, 0, 1), gg = clamp(col[1] * s, 0, 1), bcl = clamp(col[2] * s, 0, 1);
      const tri = [q[0], q[1], q[2], q[0], q[2], q[3]];
      for (let t = 0; t < 6; t++) {
        const v = tri[t];
        A.pos.push(px[v], py[v], pz[v]);
        A.nrm.push(fx, fy, fz);
        A.col.push(r, gg, bcl);
      }
    }
  }

  // Local offset (lx toward +X local, lz toward +Z local) rotated by yaw.
  function offX(lx, lz, yaw) { return lx * Math.cos(yaw) + lz * Math.sin(yaw); }
  function offZ(lx, lz, yaw) { return -lx * Math.sin(yaw) + lz * Math.cos(yaw); }

  const WOOD = [0.34, 0.24, 0.14];
  const WOOD_DARK = [0.26, 0.18, 0.10];
  const STONE = [0.42, 0.42, 0.44];
  const PAGES = [0.86, 0.80, 0.65];

  // A closed book: pages block + top/bottom cover slabs + spine.
  function buildBook(A, cx, cy, cz, yaw, tilt, cover, seed) {
    const ct = Math.cos(tilt), st = Math.sin(tilt);
    // tilted local up-vector (0,ct,st), yaw-rotated:
    const upY = ct, upLZ = st;
    const ux = offX(0, upLZ, yaw), uz = offZ(0, upLZ, yaw);
    const spX = offX(-0.185, 0, yaw), spZ = offZ(-0.185, 0, yaw); // spine on local -X
    pushBox(A, cx, cy, cz, 0.34, 0.05, 0.26, yaw, tilt, PAGES, seed);
    pushBox(A, cx + ux * -0.033, cy + upY * -0.033, cz + uz * -0.033, 0.40, 0.016, 0.30, yaw, tilt, cover, seed + 1);
    pushBox(A, cx + ux * 0.033, cy + upY * 0.033, cz + uz * 0.033, 0.40, 0.016, 0.30, yaw, tilt, cover, seed + 2);
    pushBox(A, cx + spX, cy, cz + spZ, 0.035, 0.082, 0.30, yaw, tilt, cover, seed + 3);
  }

  // A small standing decor book (spines out) for shelves.
  function buildDecor(A, cx, cy, cz, yaw, w, h, col, seed) {
    pushBox(A, cx, cy + h / 2, cz, w, h, 0.22, yaw, 0, col, seed);
  }

  function buildLectern(A, x, y, z, yaw, cover, seed) {
    pushBox(A, x, y + 0.05, z, 0.52, 0.10, 0.52, yaw, 0, WOOD_DARK, seed);
    pushBox(A, x, y + 0.58, z, 0.14, 0.96, 0.14, yaw, 0, WOOD, seed + 4);
    pushBox(A, x, y + 1.10, z, 0.64, 0.06, 0.52, yaw, -0.42, WOOD, seed + 8);
    // book resting on the tilted desk, nudged along the desk normal (0,ct,st)
    const nY = Math.cos(-0.42), nLZ = Math.sin(-0.42);
    const nx = offX(0, nLZ, yaw), nz = offZ(0, nLZ, yaw);
    buildBook(A, x + nx * 0.075, y + 1.10 + nY * 0.075, z + nz * 0.075, yaw, -0.42, cover, seed + 12);
  }

  function buildShelf(A, x, y, z, yaw, cover, seed) {
    const pX1 = offX(-0.58, 0, yaw), pZ1 = offZ(-0.58, 0, yaw);
    const pX2 = offX(0.58, 0, yaw), pZ2 = offZ(0.58, 0, yaw);
    pushBox(A, x + pX1, y + 0.62, z + pZ1, 0.12, 1.24, 0.30, yaw, 0, WOOD_DARK, seed);
    pushBox(A, x + pX2, y + 0.62, z + pZ2, 0.12, 1.24, 0.30, yaw, 0, WOOD_DARK, seed + 3);
    pushBox(A, x, y + 0.56, z, 1.28, 0.06, 0.32, yaw, 0, WOOD, seed + 6);
    pushBox(A, x, y + 1.06, z, 1.28, 0.06, 0.32, yaw, 0, WOOD, seed + 9);
    // row of decor spines on the lower plank
    for (let i = 0; i < 5; i++) {
      const t = hash2(seed + i, i * 3 + 1, 517);
      const w = 0.07 + t * 0.05, h = 0.24 + hash2(seed, i * 5 + 2, 613) * 0.10;
      const lx = -0.42 + i * 0.19;
      const col = [0.18 + t * 0.4, 0.12 + hash2(seed, i + 40, 719) * 0.3, 0.10 + t * 0.22];
      buildDecor(A, x + offX(lx, 0, yaw), y + 0.59, z + offZ(lx, 0, yaw), yaw, w, h, col, seed + 20 + i);
    }
    // the readable book lies on the top plank
    buildBook(A, x + offX(0.12, 0.02, yaw), y + 1.125, z + offZ(0.12, 0.02, yaw), yaw + 0.22, 0, cover, seed + 30);
  }

  function buildSlab(A, x, y, z, yaw, cover, seed) {
    pushBox(A, x, y + 0.12, z, 0.86, 0.24, 0.70, yaw, 0, STONE, seed);
    pushBox(A, x + offX(0.30, 0.26, yaw), y + 0.07, z + offZ(0.30, 0.26, yaw), 0.34, 0.14, 0.30, yaw + 0.5, 0, STONE, seed + 4);
    buildBook(A, x, y + 0.275, z, yaw + 0.15, 0.05, cover, seed + 8);
  }

  // Build every site + register interactables ------------------------------
  const _promptPos = []; // keep Vector3s alive (referenced by interactables)
  for (let i = 0; i < BOOKS.length; i++) {
    const b = BOOKS[i];
    const kind = b.place[2], yaw = b.place[3];
    const [x, z] = resolveDry(b.place[0], b.place[1]);
    const y = terrainHeight(x, z);
    const seed = 100 + i * 37;
    if (kind === 'lectern') buildLectern(arrs, x, y, z, yaw, b.cover, seed);
    else if (kind === 'shelf') buildShelf(arrs, x, y, z, yaw, b.cover, seed);
    else buildSlab(arrs, x, y, z, yaw, b.cover, seed);
    const pos = new THREE.Vector3(x, y + 1.0, z);
    _promptPos.push(pos);
    g.interactables.push({
      pos,
      radius: 2.8,
      label: 'Read',
      prompt: 'Read — “' + b.title + '”',
      onInteract: () => { if (!uiOpen) openBook(b, true); },
    });
  }

  const libGeo = new THREE.BufferGeometry();
  libGeo.setAttribute('position', new THREE.Float32BufferAttribute(arrs.pos, 3));
  libGeo.setAttribute('normal', new THREE.Float32BufferAttribute(arrs.nrm, 3));
  libGeo.setAttribute('color', new THREE.Float32BufferAttribute(arrs.col, 3));
  const libMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const libMesh = new THREE.Mesh(libGeo, libMat);
  libMesh.frustumCulled = false; // sites span the whole map; ~4k tris, cheap
  libMesh.matrixAutoUpdate = false;
  g.scene.add(libMesh);
  arrs.pos = arrs.nrm = arrs.col = null; // free build arrays

  // ==========================================================================
  // DIG SITE — "Disturbed Earth", spawned once the Confession is read.
  // ==========================================================================
  let digMesh = null;
  let digInter = null;

  function spawnDigSite() {
    if (digMesh) return;
    const x = DIG_POS.x, z = DIG_POS.z;
    const y = terrainHeight(x, z);
    const A = { pos: [], nrm: [], col: [] };
    const DIRT = [0.30, 0.20, 0.11];
    const DIRT2 = [0.24, 0.16, 0.09];
    pushBox(A, x, y + 0.10, z, 1.9, 0.26, 1.3, 0.3, 0, DIRT, 71);
    pushBox(A, x + 0.3, y + 0.20, z - 0.2, 1.3, 0.24, 0.9, -0.6, 0, DIRT2, 75);
    pushBox(A, x - 0.35, y + 0.26, z + 0.25, 0.9, 0.20, 0.7, 1.1, 0, DIRT, 79);
    // scattered clods
    for (let i = 0; i < 5; i++) {
      const a = hash2(80 + i, i, 331) * Math.PI * 2;
      const d = 1.1 + hash2(85 + i, i, 337) * 0.8;
      pushBox(A, x + Math.cos(a) * d, y + 0.05, z + Math.sin(a) * d,
        0.16 + hash2(i, 90, 341) * 0.12, 0.10, 0.14, a, 0, DIRT2, 90 + i);
    }
    // a leaning wooden marker stick
    pushBox(A, x + 0.9, y + 0.55, z + 0.7, 0.08, 1.1, 0.08, 0.4, 0.22, WOOD_DARK, 97);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(A.pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(A.nrm, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(A.col, 3));
    digMesh = new THREE.Mesh(geo, libMat);
    digMesh.matrixAutoUpdate = false;
    g.scene.add(digMesh);

    digInter = {
      pos: new THREE.Vector3(x, y + 0.8, z),
      radius: 2.6,
      label: 'Dig',
      prompt: 'Dig — Disturbed Earth',
      enabled: () => !g.flags.graveDug,
      onInteract: doDig,
    };
    g.interactables.push(digInter);
  }

  function removeDigSite() {
    if (!digMesh) return;
    g.scene.remove(digMesh);
    digMesh.geometry.dispose();
    digMesh = null;
    if (digInter) {
      const i = g.interactables.indexOf(digInter);
      if (i >= 0) g.interactables.splice(i, 1);
      digInter = null;
    }
  }

  function doDig() {
    if (g.flags.graveDug) return;
    g.flags.graveDug = true;
    g.flags.gravekeepersCharm = true;
    sfx('chestOpen');
    // The hoard: juicy loot piles if the loot system exists, direct gold if not.
    if (g.combat) {
      const y = terrainHeight(DIG_POS.x, DIG_POS.z) + 0.6;
      ev.emit('spawnLoot', { pos: { x: DIG_POS.x, y, z: DIG_POS.z }, kind: 'gold', amount: 90 });
      ev.emit('spawnLoot', { pos: { x: DIG_POS.x + 0.9, y, z: DIG_POS.z + 0.5 }, kind: 'gold', amount: 80 });
      ev.emit('spawnLoot', { pos: { x: DIG_POS.x - 0.7, y, z: DIG_POS.z + 0.8 }, kind: 'gold', amount: 80 });
    } else if (g.player && g.player.addGold) {
      g.player.addGold(250);
    }
    notify("The Gravedigger's Hoard", "The Gravekeeper's Charm is yours — coin finds its way to you (+10% gold found).");
    removeDigSite();
  }

  // ==========================================================================
  // READING OVERLAY + CODEX — own DOM/CSS, matches ui.js parchment/gold look.
  // ==========================================================================
  const style = document.createElement('style');
  style.textContent = `
#ef-bkroot{position:fixed;inset:0;z-index:40;display:none;pointer-events:auto;
  font-family:Georgia,'Times New Roman',serif;-webkit-tap-highlight-color:transparent;}
#ef-bkroot.on{display:block;}
#ef-bkroot *{box-sizing:border-box;-webkit-user-select:none;user-select:none;}
#ef-bkdim{position:absolute;inset:0;background:radial-gradient(ellipse at center,rgba(10,7,4,.55),rgba(6,4,2,.82));
  opacity:0;transition:opacity .25s ease;}
#ef-bkroot.on #ef-bkdim{opacity:1;}
#ef-bkpanel{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%) scale(.96);opacity:0;
  width:min(92vw,560px);height:min(84vh,700px);max-height:calc(100vh - 24px);
  display:flex;flex-direction:column;border-radius:6px;overflow:hidden;
  background:linear-gradient(165deg,#efe4c8,#e6d7b2 55%,#d9c99e);
  border:1px solid #a3813f;box-shadow:0 0 0 3px rgba(26,18,10,.9),0 0 0 4px rgba(217,180,106,.45),
  0 18px 60px rgba(0,0,0,.75);transition:transform .22s ease,opacity .22s ease;}
#ef-bkroot.on #ef-bkpanel{transform:translate(-50%,-50%) scale(1);opacity:1;}
#ef-bkpanel::after{content:'';position:absolute;inset:0;pointer-events:none;
  background:radial-gradient(ellipse at center,transparent 55%,rgba(90,62,25,.22) 100%);}
#ef-bkhead{padding:18px 52px 0 26px;text-align:center;flex:none;}
#ef-bktitle{color:#3a2a16;font-size:20px;letter-spacing:.08em;text-transform:uppercase;
  text-shadow:0 1px 0 rgba(255,248,225,.5);}
#ef-bkauthor{color:#7a6238;font-style:italic;font-size:13px;margin-top:4px;letter-spacing:.04em;}
.ef-bkrule{height:1px;margin:12px auto 0;width:78%;flex:none;
  background:linear-gradient(90deg,transparent,#a3813f 30%,#d9b46a 50%,#a3813f 70%,transparent);}
#ef-bkbody{flex:1;overflow:hidden;position:relative;padding:6px 8px 0;}
#ef-bkpage,#ef-bkcodex{position:absolute;inset:6px 8px 0;overflow-y:auto;padding:10px 20px 16px;
  color:#33261a;font-size:15.5px;line-height:1.62;-webkit-overflow-scrolling:touch;}
#ef-bkpage{white-space:pre-wrap;}
#ef-bkpage.drop::first-letter{font-size:2.6em;line-height:.9;float:left;padding:4px 7px 0 0;
  color:#6d4a1c;font-weight:bold;}
#ef-bkpage.turn-l{animation:ef-bkturnl .3s ease;}
#ef-bkpage.turn-r{animation:ef-bkturnr .3s ease;}
@keyframes ef-bkturnl{from{opacity:0;transform:translateX(22px)}to{opacity:1;transform:none}}
@keyframes ef-bkturnr{from{opacity:0;transform:translateX(-22px)}to{opacity:1;transform:none}}
#ef-bkcodex{display:none;}
#ef-bkroot.codex #ef-bkcodex{display:block;}
#ef-bkroot.codex #ef-bkpage{display:none;}
.ef-bkrow{display:flex;align-items:baseline;gap:10px;padding:9px 6px;border-bottom:1px dotted rgba(122,98,56,.4);}
.ef-bkrow .n{color:#a08553;font-size:12px;width:22px;flex:none;text-align:right;}
.ef-bkrow .t{flex:1;color:#3a2a16;}
.ef-bkrow.found .t{cursor:pointer;text-decoration:underline;text-decoration-color:rgba(163,129,63,.55);}
.ef-bkrow.found:active{background:rgba(217,180,106,.18);}
.ef-bkrow.lost .t{color:rgba(90,72,46,.5);font-style:italic;letter-spacing:.3em;}
.ef-bkrow .s{color:#8a6c2f;font-size:12px;font-style:italic;flex:none;}
#ef-bkcdxhead{color:#7a6238;font-style:italic;text-align:center;margin:2px 0 10px;font-size:13px;}
#ef-bkfoot{flex:none;display:flex;align-items:center;justify-content:space-between;
  padding:10px 14px calc(12px + env(safe-area-inset-bottom,0px));gap:10px;}
.ef-bkbtn{pointer-events:auto;cursor:pointer;color:#e8dcc0;font-size:13px;letter-spacing:.05em;
  padding:8px 14px;border-radius:5px;border:1px solid #a3813f;white-space:nowrap;
  background:linear-gradient(180deg,rgba(60,44,24,.95),rgba(34,24,13,.95));
  box-shadow:0 2px 6px rgba(0,0,0,.4);}
.ef-bkbtn:active{transform:scale(.95);}
#ef-bknav{display:flex;align-items:center;gap:8px;}
#ef-bkpageno{color:#7a6238;font-size:12.5px;font-style:italic;min-width:86px;text-align:center;}
.ef-bkarrow{width:40px;height:38px;display:flex;align-items:center;justify-content:center;
  font-size:22px;line-height:1;padding:0;}
.ef-bkarrow.off{opacity:.28;pointer-events:none;}
#ef-bkclose{position:absolute;top:8px;right:8px;z-index:2;width:38px;height:38px;cursor:pointer;
  display:flex;align-items:center;justify-content:center;border-radius:50%;
  color:#d9b46a;font-size:17px;border:1px solid rgba(163,129,63,.7);
  background:radial-gradient(circle at 35% 30%,rgba(60,44,24,.95),rgba(28,20,11,.95));}
#ef-bkclose:active{transform:scale(.92);}
@media (max-height:520px){
  #ef-bkhead{padding-top:10px;}#ef-bktitle{font-size:16px;}
  #ef-bkpage,#ef-bkcodex{font-size:14px;line-height:1.5;}
}`;
  document.head.appendChild(style);

  const root = document.createElement('div');
  root.id = 'ef-bkroot';
  root.innerHTML = `
<div id="ef-bkdim"></div>
<div id="ef-bkpanel">
  <div id="ef-bkclose">✕</div>
  <div id="ef-bkhead"><div id="ef-bktitle"></div><div id="ef-bkauthor"></div></div>
  <div class="ef-bkrule"></div>
  <div id="ef-bkbody">
    <div id="ef-bkpage"></div>
    <div id="ef-bkcodex"></div>
  </div>
  <div id="ef-bkfoot">
    <div class="ef-bkbtn" id="ef-bkcdx">📖 Codex</div>
    <div id="ef-bknav">
      <div class="ef-bkbtn ef-bkarrow" id="ef-bkprev">‹</div>
      <span id="ef-bkpageno"></span>
      <div class="ef-bkbtn ef-bkarrow" id="ef-bknext">›</div>
    </div>
  </div>
</div>`;
  document.body.appendChild(root);

  const $ = (id) => root.querySelector('#' + id);
  const elTitle = $('ef-bktitle'), elAuthor = $('ef-bkauthor');
  const elPage = $('ef-bkpage'), elCodex = $('ef-bkcodex');
  const elPrev = $('ef-bkprev'), elNext = $('ef-bknext'), elPageNo = $('ef-bkpageno');
  const elCdxBtn = $('ef-bkcdx'), elClose = $('ef-bkclose');

  // Pagination: greedy paragraph packing, ~640 chars per page.
  const pageCache = {};
  function paginate(book) {
    if (pageCache[book.id]) return pageCache[book.id];
    const paras = book.text.split('\n\n');
    const pages = [];
    let cur = '';
    for (const p of paras) {
      if (cur && cur.length + p.length > 640) { pages.push(cur); cur = p; }
      else cur = cur ? cur + '\n\n' + p : p;
    }
    if (cur) pages.push(cur);
    pageCache[book.id] = pages;
    return pages;
  }

  let uiOpen = false;
  let codexMode = false;
  let curBook = null;
  let curPage = 0;

  function countRead() {
    const fl = readFlags();
    let n = 0;
    for (const b of BOOKS) if (fl[b.id]) n++;
    return n;
  }

  function renderPage(dir) {
    const pages = paginate(curBook);
    curPage = clamp(curPage, 0, pages.length - 1);
    elPage.textContent = pages[curPage];
    elPage.classList.toggle('drop', curPage === 0);
    elPage.classList.remove('turn-l', 'turn-r');
    if (dir) { void elPage.offsetWidth; elPage.classList.add(dir > 0 ? 'turn-l' : 'turn-r'); }
    elPage.scrollTop = 0;
    elPageNo.textContent = 'Page ' + (curPage + 1) + ' of ' + pages.length;
    elPrev.classList.toggle('off', curPage === 0);
    elNext.classList.toggle('off', curPage === pages.length - 1);
  }

  function turnPage(dir) {
    const pages = paginate(curBook);
    const np = clamp(curPage + dir, 0, pages.length - 1);
    if (np === curPage) return;
    curPage = np;
    sfx('uiClick');
    renderPage(dir);
  }

  function renderCodex() {
    const fl = readFlags();
    let html = '<div id="ef-bkcdxhead">The tomes of the vale — ' + countRead() +
      ' of ' + BOOK_COUNT + ' found</div>';
    for (let i = 0; i < BOOKS.length; i++) {
      const b = BOOKS[i];
      const found = !!fl[b.id];
      html += '<div class="ef-bkrow ' + (found ? 'found' : 'lost') + '" data-i="' + i + '">' +
        '<span class="n">' + (i + 1) + '.</span>' +
        '<span class="t">' + (found ? b.title : '···') + '</span>' +
        (found && b.skill ? '<span class="s">skill book</span>' : '') +
        '</div>';
    }
    elCodex.innerHTML = html;
  }

  // The Ember Testament: the king's last lesson takes only in a hand that
  // holds Aldric's Ember. Checked on every read (world, codex, or re-read) so
  // claiming the blade after the first reading still grants it. Once, ever.
  function maybeEmberXP(book) {
    if (book.special !== 'ember' || g.flags.emberTestamentXP || !g.flags.hasAldricSword) return;
    g.flags.emberTestamentXP = true;
    if (g.rpg && g.rpg.addSkillXP) g.rpg.addSkillXP('blade', SKILL_XP);
    notify('The Ember remembers', "The king's last lesson settles into your sword-arm. (+" + SKILL_XP + ' Blade experience)');
  }

  function showReader(book, dir) {
    codexMode = false;
    root.classList.remove('codex');
    curBook = book;
    elTitle.textContent = book.title;
    elAuthor.textContent = book.author;
    elPrev.style.visibility = elNext.style.visibility = elPageNo.style.visibility = 'visible';
    renderPage(dir || 0);
    maybeEmberXP(book);
  }

  function showCodex() {
    codexMode = true;
    root.classList.add('codex');
    elTitle.textContent = 'Codex of Elderfall';
    elAuthor.textContent = countRead() + ' of ' + BOOK_COUNT + ' tomes found';
    elPrev.style.visibility = elNext.style.visibility = elPageNo.style.visibility = 'hidden';
    renderCodex();
  }

  function openOverlay() {
    if (!uiOpen) {
      uiOpen = true;
      root.classList.add('on');
      g.paused = true;
      sfx('uiClick');
    }
    elCdxBtn.textContent = '📖 Codex ' + countRead() + '/' + BOOK_COUNT;
  }

  function closeOverlay() {
    if (!uiOpen) return;
    uiOpen = false;
    root.classList.remove('on', 'codex');
    codexMode = false;
    g.paused = false;
    sfx('uiClick');
  }

  // First-read rewards + bookRead event ------------------------------------
  function markRead(book) {
    const fl = readFlags();
    const first = !fl[book.id];
    if (first) {
      fl[book.id] = true;
      if (book.skill) {
        if (g.rpg && g.rpg.addSkillXP) g.rpg.addSkillXP(book.skill, SKILL_XP);
        const skillName = book.skill.charAt(0).toUpperCase() + book.skill.slice(1);
        notify(book.title, 'Its lessons settle into your hands. (+' + SKILL_XP + ' ' + skillName + ' experience)');
      }
      if (book.special === 'grave') {
        notify('A confession, and a bearing', 'Disturbed earth lies east and a touch south of the Shrine of Aldric.');
        // dig site itself is spawned by the reconcile check in update()
      }
      if (book.special === 'ember' && !g.flags.hasAldricSword) {
        notify('The Ember Testament', 'The last page is written to a hand that holds the blade. Yours is empty.');
      }
      // Loremaster: all 24 read
      if (countRead() >= BOOK_COUNT && !g.flags.loremaster) {
        g.flags.loremaster = true;
        if (g.player && g.player.addGold) g.player.addGold(200);
        sfx('questDone');
        notify('Loremaster of Elderfall', 'Every tome in the vale, read. The dead authors thank you. (+200 gold)');
      }
    }
    ev.emit('bookRead', { id: book.id, title: book.title, first });
    return first;
  }

  function openBook(book, fromWorld) {
    openOverlay();
    curPage = 0;
    showReader(book, 0);
    if (fromWorld || !readFlags()[book.id]) markRead(book);
    else ev.emit('bookRead', { id: book.id, title: book.title, first: false });
  }

  // Wire controls -----------------------------------------------------------
  elClose.addEventListener('click', closeOverlay);
  $('ef-bkdim').addEventListener('click', closeOverlay);
  elPrev.addEventListener('click', () => turnPage(-1));
  elNext.addEventListener('click', () => turnPage(1));
  elCdxBtn.addEventListener('click', () => {
    sfx('uiClick');
    if (codexMode && curBook) showReader(curBook, 0);
    else showCodex();
  });
  elCodex.addEventListener('click', (e) => {
    const row = e.target.closest('.ef-bkrow.found');
    if (!row) return;
    const b = BOOKS[+row.dataset.i];
    if (b) { curPage = 0; showReader(b, 1); ev.emit('bookRead', { id: b.id, title: b.title, first: false }); sfx('uiClick'); }
  });

  // Swipe on the page to turn (mobile)
  let swipeX = null;
  elPage.addEventListener('pointerdown', (e) => { swipeX = e.clientX; });
  elPage.addEventListener('pointerup', (e) => {
    if (swipeX === null || codexMode) return;
    const dx = e.clientX - swipeX;
    swipeX = null;
    if (dx < -42) turnPage(1);
    else if (dx > 42) turnPage(-1);
  });

  // Keyboard: capture-phase so the pause menu / journal don't fight us while
  // the book is open. Esc closes, arrows turn pages.
  window.addEventListener('keydown', (e) => {
    if (!uiOpen) return;
    switch (e.code) {
      case 'Escape': e.preventDefault(); e.stopImmediatePropagation(); closeOverlay(); break;
      case 'ArrowRight': case 'KeyD': e.stopImmediatePropagation(); turnPage(1); break;
      case 'ArrowLeft': case 'KeyA': e.stopImmediatePropagation(); turnPage(-1); break;
      case 'KeyJ': case 'Tab': case 'KeyQ': case 'KeyE': case 'Space':
        e.preventDefault(); e.stopImmediatePropagation(); break;
    }
  }, true);

  // Re-sync after a save loads (flags object may be swapped wholesale).
  ev.on('gameLoaded', () => { frame = CHECK_EVERY - 1; });

  // ==========================================================================
  // update — nearly free: throttled reconcile of the dig site vs. flags.
  // No per-frame allocations.
  // ==========================================================================
  const CHECK_EVERY = 30;
  let frame = 0;

  function update() {
    frame++;
    if (frame < CHECK_EVERY) return;
    frame = 0;
    const fl = g.flags;
    const confessionRead = !!(fl.books && fl.books.confession);
    if (confessionRead && !fl.graveDug && !digMesh) spawnDigSite();
    else if (fl.graveDug && digMesh) removeDigSite();
    // safety: if something external closed pause while our overlay is open,
    // re-assert (dialogue can't start while we're open — interact is guarded).
    if (uiOpen && !g.paused) g.paused = true;
  }

  return { update };
}

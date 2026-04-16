import { useState, useEffect, useCallback } from "react";

// ── Artwork mapped to thematic quote groups ──────────────────────────
const ART_MAP: Record<string, string> = {
  "fingolfin-morgoth": "/art/tolkien-fingolfin-morgoth.jpg",
  "rohirrim-charge":   "/art/tolkien-rohirrim-charge.jpg",
  "gandalf-counsel":   "/art/tolkien-gandalf-counsel.jpg",
  "palantir":          "/art/tolkien-palantir.jpg",
  "mordor-fortress":   "/art/tolkien-mordor-fortress.jpg",
  "fellowship-road":   "/art/tolkien-fellowship-road.jpg",
  "duel-of-songs":     "/art/tolkien-duel-of-songs.jpg",
  "star-hope":         "/art/tolkien-star-hope.jpg",
  "feanor-oath":       "/art/tolkien-feanor-oath.jpg",
  "sword-reforged":    "/art/tolkien-sword-reforged.jpg",
};

// ── Deep Tolkien lore: strategy, battle, alliances, counsel, defiance ─
// Sources: The Silmarillion, Children of Húrin, Lay of Leithian,
// Unfinished Tales, The Lord of the Rings, Appendices, Letters
const ELVISH_QUOTES = [

  // ── FIRST AGE: Defiance & Doom ──────────────────────────────────────

  // Húrin's last stand — Nirnaeth Arnoediad (The Silmarillion)
  { quote: "Aurë entuluva! Day shall come again!", attribution: "Húrin Thalion, Nirnaeth Arnoediad — The Silmarillion", art: "fingolfin-morgoth" },
  { quote: "Last of all Húrin stood alone. He cast aside his shield, and wielded an axe two-handed; and it is sung that the axe smoked in the black blood of the troll-guard of Gothmog until it withered.", attribution: "The Silmarillion, Of the Fifth Battle", art: "fingolfin-morgoth" },

  // Húrin vs Morgoth — defiance under torment (Children of Húrin)
  { quote: "Blind you are, Morgoth Bauglir, and blind shall ever be, seeing only the dark. You know not what rules the hearts of Men, and if you knew you could not give it.", attribution: "Húrin to Morgoth — The Children of Húrin", art: "fingolfin-morgoth" },
  { quote: "You have none. But you will not come at Turgon through them; for they do not know his secrets.", attribution: "Húrin to Morgoth — The Children of Húrin", art: "fingolfin-morgoth" },
  { quote: "You are not the Lord of Men, and shall not be, though all Arda and Menel fall in your dominion. Beyond the Circles of the World you shall not pursue those who refuse you.", attribution: "Húrin to Morgoth — The Children of Húrin", art: "mordor-fortress" },

  // Fingolfin challenges Morgoth — single combat at Angband
  { quote: "Come forth, thou coward king, to fight with thine own hand! Den-dweller, wielder of thralls, liar and lurker, foe of Gods and Elves, come! For I would see thy craven face.", attribution: "Fingolfin to Morgoth — The Silmarillion", art: "fingolfin-morgoth" },
  { quote: "Fingolfin gleamed beneath him as a star; and the cries of Morgoth echoed in the Northlands.", attribution: "The Silmarillion, Of the Ruin of Beleriand", art: "fingolfin-morgoth" },
  { quote: "He wounded Morgoth with seven wounds, and seven times Morgoth gave a cry of anguish, whereat the hosts of Angband fell upon their faces in dismay.", attribution: "The Silmarillion, Of Fingolfin and Morgoth", art: "fingolfin-morgoth" },

  // Fëanor's defiance at Tirion
  { quote: "If Fëanor cannot overthrow Morgoth, at least he delays not to assail him, and sits not idle in grief. And it may be that Eru has set in me a fire greater than thou knowest.", attribution: "Fëanor to the Herald of Manwë — The Silmarillion", art: "feanor-oath" },
  { quote: "Such hurt at the least will I do to the Foe of the Valar that even the mighty in the Ring of Doom shall wonder to hear it.", attribution: "Fëanor — The Silmarillion", art: "feanor-oath" },

  // Finrod vs Sauron — the duel of songs (Lay of Leithian)
  { quote: "He chanted a song of wizardry, of piercing, opening, of treachery, revealing, uncovering, betraying.", attribution: "Of Sauron's Song — The Lay of Leithian", art: "duel-of-songs" },
  { quote: "Then Felagund there swaying sang in answer a song of staying, resisting, battling against power, of secrets kept, strength like a tower, and trust unbroken, freedom, escape.", attribution: "Finrod Felagund — The Lay of Leithian", art: "duel-of-songs" },
  { quote: "Backwards and forwards swayed their song. Reeling and foundering, as ever more strong the chanting swelled, Felagund fought, and all the magic and might he brought of Elvenesse into his words.", attribution: "The Lay of Leithian", art: "duel-of-songs" },

  // Fingolfin's oath of allegiance
  { quote: "Half-brother in blood, full brother in heart will I be. Thou shalt lead and I will follow.", attribution: "Fingolfin to Fëanor — The Silmarillion", art: "fellowship-road" },

  // The Music of the Ainur — creation itself
  { quote: "And thou, Melkor, shalt see that no theme may be played that hath not its uttermost source in me, nor can any alter the music in my despite. For he that attempteth this shall prove but mine instrument.", attribution: "Eru Ilúvatar to Melkor — Ainulindalë", art: "duel-of-songs" },

  // Beor on the journey west
  { quote: "A darkness lies behind us, and we have turned our backs on it, and we do not desire to return thither even in thought. Westwards our hearts have been turned, and we believe that there we shall find Light.", attribution: "Bëor the Old — The Silmarillion", art: "fellowship-road" },

  // ── SECOND AGE & WAR OF THE LAST ALLIANCE ──────────────────────────

  { quote: "It is not despair, for despair is only for those who see the end beyond all doubt. We do not.", attribution: "Gandalf, The Fellowship of the Ring", art: "gandalf-counsel" },
  { quote: "Oft evil will shall evil mar.", attribution: "Théoden King — The Two Towers", art: "rohirrim-charge" },

  // ── THIRD AGE: War of the Ring ─────────────────────────────────────

  // Gandalf on despair and counsel
  { quote: "No counsel have I to give to those that despair. Yet counsel I could give, and words I could speak to you. Will you hear them?", attribution: "Gandalf to Théoden — The Two Towers", art: "gandalf-counsel" },
  { quote: "Many folk like to know beforehand what is to be set on the table; but those who have laboured to prepare the feast like to keep their secret; for wonder makes the words of praise louder.", attribution: "Gandalf — The Fellowship of the Ring", art: "gandalf-counsel" },
  { quote: "He that breaks a thing to find out what it is has left the path of wisdom.", attribution: "Gandalf — The Fellowship of the Ring", art: "gandalf-counsel" },
  { quote: "It is not our part to master all the tides of the world, but to do what is in us for the succour of those years wherein we are set.", attribution: "Gandalf — The Return of the King", art: "gandalf-counsel" },

  // Denethor's palantír-darkened wisdom
  { quote: "I have seen more than thou knowest, Grey Fool. For thy hope is but ignorance.", attribution: "Denethor — The Return of the King", art: "palantir" },
  { quote: "The rule of no realm is mine. But all worthy things that are in peril as the world now stands, those are my care.", attribution: "Gandalf — The Return of the King", art: "gandalf-counsel" },

  // Théoden's rebirth and final ride
  { quote: "Where is the horse and the rider? Where is the horn that was blowing? They have passed like rain on the mountain, like wind in the meadow.", attribution: "Théoden — The Two Towers", art: "rohirrim-charge" },
  { quote: "Arise, arise, Riders of Théoden! Spear shall be shaken, shield shall be splintered, a sword-day, a red day, ere the sun rises!", attribution: "Théoden, The Ride of the Rohirrim", art: "rohirrim-charge" },

  // Aragorn & Gilraen
  { quote: "Ónen i-Estel Edain, ú-chebin estel anim. I gave Hope to the Dúnedain, I have kept no hope for myself.", attribution: "Gilraen's Linnod — Appendix A", art: "sword-reforged" },
  { quote: "Yet there may be a light beyond the darkness; and if so, I would have you see it and be glad.", attribution: "Aragorn to Gilraen — Appendix A", art: "star-hope" },
  { quote: "From the ashes a fire shall be woken, a light from the shadows shall spring; renewed shall be blade that was broken, the crownless again shall be king.", attribution: "The Riddle of Strider", art: "sword-reforged" },

  // Faramir on war
  { quote: "War must be, while we defend our lives against a destroyer who would devour all; but I do not love the bright sword for its sharpness, nor the arrow for its swiftness, nor the warrior for his glory. I love only that which they defend.", attribution: "Faramir — The Two Towers", art: "rohirrim-charge" },

  // Elrond's counsel
  { quote: "Many are the strange chances of the world, and help oft shall come from the hands of the weak when the Wise falter.", attribution: "Mithrandir — The Silmarillion", art: "gandalf-counsel" },
  { quote: "The road must be trod, but it will be very hard. And neither strength nor wisdom will carry us far upon it. This quest may be attempted by the weak with as much hope as the strong.", attribution: "Elrond — The Fellowship of the Ring", art: "fellowship-road" },

  // Sam & Frodo — endurance
  { quote: "There, peeping among the cloud-wrack above a dark tor high up in the mountains, Sam saw a white star twinkle for a while. The beauty of it smote his heart, as he looked up out of the forsaken land, and hope returned to him.", attribution: "The Return of the King, The Land of Shadow", art: "star-hope" },
  { quote: "I know. It's all wrong. By rights we shouldn't even be here. But we are. Folk in those stories had lots of chances of turning back, only they didn't. They kept going.", attribution: "Samwise Gamgee — The Two Towers", art: "fellowship-road" },

  // Alliance & fellowship
  { quote: "Faithless is he that says farewell when the road darkens.", attribution: "Gimli — The Fellowship of the Ring", art: "fellowship-road" },
  { quote: "Deeds will not be less valiant because they are unpraised.", attribution: "Aragorn — The Return of the King", art: "sword-reforged" },

  // Tolkien on war (Letters)
  { quote: "The utter stupid waste of war, not only material but moral and spiritual, is so staggering to those who have to endure it. And always was, and always will be.", attribution: "J.R.R. Tolkien, Letter 64", art: "rohirrim-charge" },

  // Sauron's dominion described
  { quote: "Sauron was become now a sorcerer of dreadful power, master of shadows and of phantoms, foul in wisdom, cruel in strength, misshaping what he touched, twisting what he ruled; his dominion was torment.", attribution: "The Silmarillion, Of Beren and Lúthien", art: "mordor-fortress" },

  // The Eucatastrophe
  { quote: "Is everything sad going to come untrue?", attribution: "Samwise Gamgee — The Return of the King", art: "star-hope" },
];

// ── Status messages (palantír activity) ──────────────────────────────
const STATUS_MESSAGES = [
  "The palantír grows warm...",
  "Consulting the White Council...",
  "Reading the stars of Elbereth...",
  "The Eye of Manwë turns inward...",
  "Scouring the libraries of Minas Tirith...",
  "Seeking counsel in the halls of Imladris...",
  "The seeing-stone awakens...",
  "Tracing the paths of the Istari...",
  "Listening to the winds of Ossë...",
  "The Anor-stone speaks...",
  "Unravelling the threads of fate...",
  "Reading the runes of Celebrimbor...",
  "Gazing into the depths of Orthanc...",
  "Summoning the wisdom of the Firstborn...",
  "The visions of Elendil take shape...",
  // Meta intelligence gathering
  "Scouring tournament scrolls across the realm...",
  "The stone peers into recent battles...",
  "Studying the strategies of rival commanders...",
  "Surveying the field of war as it stands today...",
  "Cross-referencing the annals of recent conquest...",
  "Mapping the movements of enemy forces...",
  "Analyzing the latest dispatches from the front...",
];

// Palantír SVG for loading
function PalantirOrb() {
  return (
    <div className="relative w-24 h-24 stone-glow">
      <svg viewBox="0 0 96 96" fill="none" className="w-full h-full">
        {/* Outer decorative ring — slow spinning */}
        <g className="slow-spin" style={{ transformOrigin: "48px 48px" }}>
          <circle cx="48" cy="48" r="44" stroke="hsl(152 42% 45% / 0.2)" strokeWidth="0.5" strokeDasharray="4 8" />
        </g>

        {/* Stone cradle ring */}
        <circle cx="48" cy="48" r="38" stroke="hsl(152 42% 45% / 0.3)" strokeWidth="1" />

        {/* Inner sphere — the seeing stone */}
        <circle cx="48" cy="48" r="28" stroke="hsl(152 42% 45% / 0.5)" strokeWidth="1.2" />
        <circle cx="48" cy="48" r="28" fill="hsl(152 42% 45% / 0.03)" />

        {/* Eye iris */}
        <ellipse cx="48" cy="48" rx="14" ry="20" stroke="hsl(152 42% 45% / 0.6)" strokeWidth="0.8" />

        {/* Pupil — vision point */}
        <circle cx="48" cy="48" r="7" fill="hsl(152 42% 45% / 0.35)" />
        <circle cx="48" cy="48" r="3.5" fill="hsl(152 42% 45% / 0.5)" />

        {/* Moonlight reflections */}
        <circle cx="42" cy="40" r="3" fill="hsl(152 42% 45% / 0.2)" />
        <circle cx="40" cy="38" r="1.5" fill="hsl(152 42% 45% / 0.35)" />

        {/* Three stars of Elendil */}
        <circle cx="48" cy="8" r="1.5" fill="hsl(152 42% 45% / 0.5)" />
        <circle cx="32" cy="13" r="1" fill="hsl(152 42% 45% / 0.35)" />
        <circle cx="64" cy="13" r="1" fill="hsl(152 42% 45% / 0.35)" />
      </svg>
    </div>
  );
}

interface LoadingOverlayProps {
  visible: boolean;
}

export default function LoadingOverlay({ visible }: LoadingOverlayProps) {
  const [currentQuote, setCurrentQuote] = useState(() =>
    ELVISH_QUOTES[Math.floor(Math.random() * ELVISH_QUOTES.length)]
  );
  const [statusMsg, setStatusMsg] = useState(() =>
    STATUS_MESSAGES[Math.floor(Math.random() * STATUS_MESSAGES.length)]
  );
  const [quoteKey, setQuoteKey] = useState(0);
  const [imgLoaded, setImgLoaded] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [progress, setProgress] = useState(0);

  // Resolve artwork URL for current quote
  const artSrc = currentQuote.art ? ART_MAP[currentQuote.art] : undefined;

  // Reset imgLoaded when art changes
  useEffect(() => {
    setImgLoaded(false);
  }, [artSrc]);

  // Cycle quotes every 12s — unhurried, let the reader dwell
  const cycleQuote = useCallback(() => {
    setCurrentQuote(ELVISH_QUOTES[Math.floor(Math.random() * ELVISH_QUOTES.length)]);
    setQuoteKey((k) => k + 1);
  }, []);

  useEffect(() => {
    if (!visible) return;
    const interval = setInterval(cycleQuote, 17000);
    return () => clearInterval(interval);
  }, [visible, cycleQuote]);

  // Cycle status messages every 5s
  useEffect(() => {
    if (!visible) return;
    const interval = setInterval(() => {
      setStatusMsg(STATUS_MESSAGES[Math.floor(Math.random() * STATUS_MESSAGES.length)]);
    }, 5000);
    return () => clearInterval(interval);
  }, [visible]);

  // Preload next couple of images
  useEffect(() => {
    if (!visible) return;
    const artKeys = Object.values(ART_MAP);
    artKeys.forEach((src) => {
      const img = new Image();
      img.src = src;
    });
  }, [visible]);

  // Elapsed timer + progress bar
  useEffect(() => {
    if (!visible) {
      setElapsed(0);
      setProgress(0);
      return;
    }
    const start = Date.now();
    const tick = setInterval(() => {
      const secs = Math.floor((Date.now() - start) / 1000);
      setElapsed(secs);
      // Asymptotic progress: fast to 60%, slows to 90%, never hits 100%
      // Typical analysis ~60-90s
      const pct = secs < 10
        ? secs * 4          // 0-40% in first 10s (card lookups)
        : secs < 30
        ? 40 + (secs - 10) * 1.5  // 40-70% in 10-30s (meta data)
        : secs < 70
        ? 70 + (secs - 30) * 0.5  // 70-90% in 30-70s (AI analysis)
        : 90 + Math.min(8, (secs - 70) * 0.1); // 90-98% slow crawl
      setProgress(Math.min(98, pct));
    }, 500);
    return () => clearInterval(tick);
  }, [visible]);

  if (!visible) return null;

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return m > 0 ? `${m}:${sec.toString().padStart(2, "0")}` : `${sec}s`;
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-background/95 backdrop-blur-md overflow-hidden"
      data-testid="loading-overlay"
    >
      {/* Background artwork — fades with each quote */}
      {artSrc && (
        <div
          key={`art-${quoteKey}`}
          className="absolute inset-0 art-bg-fade"
        >
          <img
            src={artSrc}
            alt=""
            onLoad={() => setImgLoaded(true)}
            className={`w-full h-full object-cover object-center transition-opacity duration-[2000ms] dark:invert-0 invert ${
              imgLoaded ? "opacity-[0.18]" : "opacity-0"
            }`}
          />
          {/* Gradient vignette overlay for readability */}
          <div className="absolute inset-0 bg-gradient-to-t from-background via-background/80 to-background/60" />
        </div>
      )}

      {/* Content — above artwork */}
      <div className="relative z-10 flex flex-col items-center justify-center">
        {/* Palantír orb */}
        <PalantirOrb />

        {/* Elvish quote — the star of the show */}
        <div className="mt-8 mb-6 max-w-lg px-6 text-center min-h-[120px] flex flex-col items-center justify-center">
          <p
            key={quoteKey}
            className="font-elvish italic text-lg sm:text-xl text-foreground/70 leading-relaxed quote-cycle"
          >
            "{currentQuote.quote}"
          </p>
          <p
            key={`attr-${quoteKey}`}
            className="font-elvish text-sm text-primary/50 mt-3 quote-cycle"
          >
            — {currentQuote.attribution}
          </p>
        </div>

        {/* Progress bar + status */}
        <div className="w-64 sm:w-80 space-y-2">
          {/* Progress bar */}
          <div className="h-1 bg-border/30 rounded-full overflow-hidden">
            <div
              className="h-full bg-primary/60 rounded-full transition-all duration-1000 ease-out"
              style={{ width: `${progress}%` }}
            />
          </div>
          {/* Status message + elapsed */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-primary/60 animate-pulse" />
              <p className="text-xs text-muted-foreground tracking-wide">
                {statusMsg}
              </p>
            </div>
            <p className="text-xs text-muted-foreground/50 font-mono">
              {formatTime(elapsed)}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

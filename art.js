// @ts-nocheck
/* ---- AUTISTIK illustration kit: original flat-style people, scenes and companion avatars (SVG strings) ---- */
const ART = (() => {
  const SKIN = ["#5C3A21","#8D5524","#B9773F","#D9A066","#F1C27D","#FFE0BD"];
  const INK = "#1E1B2E";
  let uid = 0;
  const id = p => p + (++uid);

  function hairBack(h, c){
    switch(h){
      case "afro": return `<circle cx="0" cy="-10" r="47" fill="${c}"/><circle cx="-34" cy="-30" r="16" fill="${c}"/><circle cx="34" cy="-30" r="16" fill="${c}"/><circle cx="0" cy="-48" r="18" fill="${c}"/>`;
      case "long": return `<path d="M-38 -12 C-44 -46 44 -46 38 -12 L44 74 C30 82 -30 82 -44 74 Z" fill="${c}"/>`;
      case "locs": { let s=""; for(let x=-40;x<=40;x+=10) s+=`<rect x="${x-4}" y="-24" width="9" height="${80-Math.abs(x)*0.5}" rx="4.5" fill="${c}"/>`; return s; }
      case "bun": return `<circle cx="0" cy="-46" r="14" fill="${c}"/>`;
      case "hijab": return `<path d="M-46 -4 C-48 -56 48 -56 46 -4 L56 76 C30 90 -30 90 -56 76 Z" fill="${c}"/>`;
      case "pony": return `<path d="M28 -20 C52 -18 56 20 46 52 C40 40 36 22 30 10 Z" fill="${c}"/>`;
      default: return "";
    }
  }
  function hairFront(h, c){
    switch(h){
      case "short": return `<path d="M-33 -2 C-36 -38 -14 -48 2 -47 C24 -46 37 -32 33 -2 C27 -18 14 -27 -2 -27 C-16 -27 -27 -16 -33 -2 Z" fill="${c}"/>`;
      case "curly": return `<path d="M-33 -2 C-36 -38 -14 -48 2 -47 C24 -46 37 -32 33 -2 C27 -18 14 -27 -2 -27 C-16 -27 -27 -16 -33 -2 Z" fill="${c}"/>` +
        [[-26,-28],[-14,-38],[0,-42],[14,-38],[26,-28],[32,-14],[-32,-14]].map(([x,y])=>`<circle cx="${x}" cy="${y}" r="10" fill="${c}"/>`).join("");
      case "afro": return `<path d="M-32 -4 C-30 -30 30 -30 32 -4 C24 -16 -24 -16 -32 -4 Z" fill="${c}"/>`;
      case "long": return `<path d="M-34 4 C-38 -40 30 -50 35 -6 C22 -28 -4 -24 -34 4 Z" fill="${c}"/>`;
      case "pony": return `<path d="M-33 -2 C-36 -40 34 -44 33 -2 C26 -20 -8 -28 -33 -2 Z" fill="${c}"/>`;
      case "locs": return `<path d="M-33 -4 C-35 -40 35 -40 33 -4 C24 -20 -24 -20 -33 -4 Z" fill="${c}"/>`;
      case "bun": return `<path d="M-33 -2 C-36 -40 34 -42 33 -2 C26 -22 -26 -22 -33 -2 Z" fill="${c}"/>`;
      case "buzz": return `<path d="M-31 -6 C-31 -42 31 -42 31 -6 C24 -22 -24 -22 -31 -6 Z" fill="${c}" opacity=".7"/>`;
      case "hijab": return `<path d="M-35 -4 C-35 -46 35 -46 35 -4 C26 -26 -26 -26 -35 -4 Z" fill="${c}"/>`;
      default: return "";
    }
  }
  function prop(kind, skin, accent){
    const hands = (y=104) => `<circle cx="-28" cy="${y}" r="8.5" fill="${skin}"/><circle cx="28" cy="${y}" r="8.5" fill="${skin}"/>`;
    switch(kind){
      case "book": return `<rect x="-30" y="84" width="60" height="38" rx="4" fill="${accent}"/><path d="M0 86 V120" stroke="#fff" stroke-opacity=".6" stroke-width="2"/><path d="M-22 94h14M-22 102h14M8 94h14M8 102h10" stroke="#fff" stroke-opacity=".7" stroke-width="2.5" stroke-linecap="round"/>` + hands(108);
      case "sketch": return `<rect x="-30" y="80" width="60" height="44" rx="4" fill="#fff"/><path d="M-20 108 C-10 88 4 112 18 92" stroke="${accent}" stroke-width="4" fill="none" stroke-linecap="round"/><circle cx="-12" cy="92" r="5" fill="#F5C935"/><rect x="24" y="70" width="6" height="34" rx="3" transform="rotate(30 27 87)" fill="#F39A2B"/>` + hands(110);
      case "controller": return `<rect x="-28" y="90" width="56" height="26" rx="13" fill="#2A2F4A"/><path d="M-17 103h10M-12 98v10" stroke="#fff" stroke-width="3" stroke-linecap="round"/><circle cx="12" cy="100" r="3.2" fill="#F5C935"/><circle cx="19" cy="106" r="3.2" fill="#3DB66A"/>` + hands(106);
      case "mug": return `<rect x="-6" y="86" width="26" height="30" rx="5" fill="${accent}"/><path d="M20 92 C30 92 30 108 20 108" stroke="${accent}" stroke-width="4" fill="none"/><path d="M2 78 C-2 72 6 70 2 64 M12 78 C8 72 16 70 12 64" stroke="#fff" stroke-opacity=".7" stroke-width="2.5" fill="none" stroke-linecap="round"/><circle cx="-8" cy="102" r="8.5" fill="${skin}"/>`;
      case "laptop": return `<path d="M-36 120 L-28 86 H28 L36 120 Z" fill="#2A2F4A"/><rect x="-24" y="90" width="48" height="24" rx="2" fill="${accent}" opacity=".85"/><path d="M-16 98h20M-16 104h28" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/>` + hands(116);
      case "mic": return `<path d="M-22 84 C-30 70 -26 56 -14 46" stroke="#2A2F4A" stroke-width="5" stroke-linecap="round" fill="none"/><circle cx="-12" cy="40" r="8" fill="#2A2F4A"/><circle cx="-24" cy="88" r="8.5" fill="${skin}"/>`;
      case "wave": return `<path d="M-50 74 C-58 60 -64 46 -66 30" stroke="${accent}" stroke-width="17" stroke-linecap="round" fill="none"/><circle cx="-67" cy="22" r="10" fill="${skin}"/><path d="M-82 14 a10 10 0 0 1 4 -10 M-86 26 a16 16 0 0 1 2 -18" stroke="#fff" stroke-opacity=".8" stroke-width="2.5" fill="none" stroke-linecap="round"/>`;
      case "plant": return `<path d="M-14 120 L-10 96 H14 L18 120 Z" fill="#B5651D"/><path d="M2 96 C0 80 -10 74 -18 70 C-8 70 0 76 2 86 C4 74 12 66 22 66 C14 72 6 80 4 96" fill="#3DB66A"/>` + hands(108);
      case "heart": return `<path d="M0 118 C-30 98 -28 78 -14 78 C-6 78 -2 84 0 88 C2 84 6 78 14 78 C28 78 30 98 0 118 Z" fill="#E8453C"/>` + hands(102);
      default: return "";
    }
  }
  /* person: o = {skin, hair, hairColor, shirt, glasses, headphones, hp, lanyard, prop, accent, calm, older} */
  function person(o, x, y, s=1){
    const skin = SKIN[o.skin ?? 3];
    const hc = o.hairColor || "#2B1A12";
    const shirt = o.shirt || "#6141D4";
    const eyes = o.calm
      ? `<path d="M-15 4 Q-11 8 -7 4 M7 4 Q11 8 15 4" stroke="${INK}" stroke-width="2.6" fill="none" stroke-linecap="round"/>`
      : `<ellipse cx="-11" cy="3" rx="3.5" ry="4.2" fill="${INK}"/><ellipse cx="11" cy="3" rx="3.5" ry="4.2" fill="${INK}"/><circle cx="-10" cy="1.6" r="1.2" fill="#fff"/><circle cx="12" cy="1.6" r="1.2" fill="#fff"/>`;
    const brows = o.hair==="hijab" ? "" : `<path d="M-16 -7 Q-11 -10 -6 -7 M6 -7 Q11 -10 16 -7" stroke="${hc}" stroke-width="2.6" fill="none" stroke-linecap="round"/>`;
    const lines = o.older ? `<path d="M-22 -2 l-4 -2 M22 -2 l4 -2" stroke="${INK}" stroke-opacity=".35" stroke-width="1.6" stroke-linecap="round"/>` : "";
    const mouth = o.open ? `<path d="M-8 14 Q0 26 8 14 Z" fill="${INK}"/><path d="M-5 19 Q0 23 5 19" fill="#E8453C"/>` : `<path d="M-9 14 Q0 22 9 14" stroke="${INK}" stroke-width="2.6" fill="none" stroke-linecap="round"/>`;
    const glasses = o.glasses ? `<g fill="none" stroke="${INK}" stroke-width="2.4"><circle cx="-11" cy="3" r="8.5"/><circle cx="11" cy="3" r="8.5"/><path d="M-2.5 3h5M-19.5 1 L-30 -2 M19.5 1 L30 -2"/></g>` : "";
    const hp = o.headphones ? `<path d="M-37 4 C-39 -52 39 -52 37 4" fill="none" stroke="${o.hp||"#0B857A"}" stroke-width="7" stroke-linecap="round"/><rect x="-46" y="-8" width="14" height="27" rx="7" fill="${o.hp||"#0B857A"}"/><rect x="32" y="-8" width="14" height="27" rx="7" fill="${o.hp||"#0B857A"}"/>` : "";
    const lany = o.lanyard ? `<path d="M-14 52 L-5 92 M14 52 L5 92" stroke="#2E7D32" stroke-width="4.5"/>${[60,72,84].map(yy=>`<circle cx="${-14+ (yy-52)*0.225}" cy="${yy}" r="2.6" fill="#F5C935"/><circle cx="${14-(yy-52)*0.225}" cy="${yy}" r="2.6" fill="#F5C935"/>`).join("")}<rect x="-9" y="90" width="18" height="22" rx="3" fill="#fff"/><circle cx="0" cy="98" r="4" fill="#F5C935"/>` : "";
    const ears = o.hair==="hijab" ? "" : `<circle cx="-31" cy="5" r="6.5" fill="${skin}"/><circle cx="31" cy="5" r="6.5" fill="${skin}"/>`;
    const pin = o.pin ? `<g transform="translate(-36 74) scale(.42)"><path d="M12 4C6.5 4 3 7.8 3 12s3.5 8 9 8c4.6 0 7.7-3.6 12-8 4.3-4.4 7.4-8 12-8 5.5 0 9 3.8 9 8s-3.5 8-9 8c-4.6 0-7.7-3.6-12-8C19.7 7.6 16.6 4 12 4z" fill="none" stroke="#F5C935" stroke-width="5" stroke-linecap="round"/></g>` : "";
    return `<g transform="translate(${x} ${y}) scale(${s})">
      ${hairBack(o.hair, o.hair==="hijab" ? (o.scarf||"#0B857A") : hc)}
      <path d="M-64 134 L-60 84 C-58 62 -40 54 -22 50 L22 50 C40 54 58 62 60 84 L64 134 Z" fill="${shirt}"/>
      <path d="M-16 50 L0 66 L16 50" fill="none" stroke="#000" stroke-opacity=".16" stroke-width="3"/>
      <rect x="-11" y="24" width="22" height="30" rx="9" fill="${skin}"/><rect x="-11" y="24" width="22" height="12" rx="6" fill="#000" opacity=".1"/>
      ${lany}${pin}
      ${ears}
      <ellipse cx="0" cy="0" rx="31" ry="35" fill="${skin}"/>
      <circle cx="-19" cy="14" r="5.5" fill="#FF7A6B" opacity=".35"/><circle cx="19" cy="14" r="5.5" fill="#FF7A6B" opacity=".35"/>
      ${eyes}${brows}${lines}${mouth}
      ${hairFront(o.hair, o.hair==="hijab" ? (o.scarf||"#0B857A") : hc)}
      ${glasses}${hp}
      ${prop(o.prop, skin, o.accent || "#F39A2B")}
    </g>`;
  }
  const spark = (x,y,r,c) => `<path d="M${x} ${y-r} Q${x} ${y} ${x+r} ${y} Q${x} ${y} ${x} ${y+r} Q${x} ${y} ${x-r} ${y} Q${x} ${y} ${x} ${y-r} Z" fill="${c}"/>`;
  const INF = "M55 18C30 18 14 35 14 55s16 37 41 37c21 0 35-16 55-37 20-21 34-37 55-37 25 0 41 17 41 37s-16 37-41 37c-21 0-35-16-55-37C90 34 76 18 55 18z";
  function specGrad(gid){ return `<linearGradient id="${gid}" x1="0" x2="1"><stop offset="0" stop-color="#E8453C"/><stop offset=".2" stop-color="#F39A2B"/><stop offset=".4" stop-color="#F5C935"/><stop offset=".6" stop-color="#3DB66A"/><stop offset=".8" stop-color="#2F8FE0"/><stop offset="1" stop-color="#7B55E0"/></linearGradient>`; }

  function hero(){
    const g=id("hg"), c=id("hc");
    return `<svg viewBox="0 0 520 360" preserveAspectRatio="xMidYMax slice" role="img" aria-label="Illustration of a diverse group of autistic friends smiling together, some wearing headphones and sunflower lanyards">
      <defs>${specGrad(g)}<clipPath id="${c}"><rect width="520" height="360" rx="0"/></clipPath></defs>
      <g clip-path="url(#${c})">
      <circle cx="96" cy="250" r="120" fill="#D9472F" opacity=".22"/><circle cx="430" cy="230" r="130" fill="#6141D4" opacity=".28"/><circle cx="270" cy="330" r="150" fill="#0B857A" opacity=".22"/><circle cx="300" cy="90" r="70" fill="#F5B82E" opacity=".18"/>
      <g transform="translate(40 -6) scale(2)" opacity=".9"><path class="inf-path" d="${INF}" pathLength="420" fill="none" stroke="url(#${g})" stroke-width="7" stroke-linecap="round"/></g>
      ${spark(470,60,12,"#F5C935")}${spark(60,70,9,"#FF7C66")}${spark(250,40,7,"#3FCABB")}
      ${person({skin:5,hair:"buzz",hairColor:"#8E8E99",shirt:"#0B857A",older:true,glasses:true,prop:"mug",accent:"#F5B82E"},262,182,.86)}
      ${person({skin:2,hair:"bun",hairColor:"#5A2A82",shirt:"#F39A2B",headphones:true,hp:"#6141D4",pin:true},378,190,.84)}
      ${person({skin:3,hair:"afro",hairColor:"#1B1B1F",shirt:"#D9472F",headphones:true,hp:"#0B857A",prop:"wave",accent:"#D9472F",open:true},92,226,1.0)}
      ${person({skin:4,hair:"long",hairColor:"#6B3E1F",shirt:"#6141D4",prop:"sketch",accent:"#D9472F",lanyard:true},200,214,1.1)}
      ${person({skin:0,hair:"locs",hairColor:"#1B1B1F",shirt:"#F5B82E",glasses:true,prop:"controller",open:true},318,210,1.14)}
      ${person({skin:1,hair:"hijab",scarf:"#3FCABB",shirt:"#2F6FB5",prop:"book",accent:"#F39A2B",lanyard:true},440,226,1.0)}
      </g></svg>`;
  }
  function group(gid){
    const bg = `<rect width="240" height="150" style="fill:var(--gs)"/>`;
    const cl = id("gc");
    const wrap = inner => `<svg viewBox="0 0 240 150" preserveAspectRatio="xMidYMid slice" role="img" aria-hidden="true"><defs><clipPath id="${cl}"><rect width="240" height="150"/></clipPath></defs><g clip-path="url(#${cl})">${bg}${inner}</g></svg>`;
    switch(gid){
      case "lounge": return wrap(`<circle cx="200" cy="30" r="44" fill="#F5B82E" opacity=".35"/>
        <g><rect x="18" y="14" width="64" height="30" rx="15" fill="#fff"/><path d="M40 44 l-6 10 14-10z" fill="#fff"/><text x="50" y="35" text-anchor="middle" font-family="Unbounded, system-ui, sans-serif" font-size="14" font-weight="700" fill="#D9472F">hi!</text></g>
        <g><rect x="158" y="20" width="48" height="28" rx="14" fill="#fff"/><path d="M178 48 l4 9 6-9z" fill="#fff"/><path d="M182 40 C170 32 172 25 177 25 C180 25 181 27 182 29 C183 27 184 25 187 25 C192 25 194 32 182 40 Z" fill="#E8453C"/></g>
        ${person({skin:3,hair:"afro",hairColor:"#1B1B1F",shirt:"#D9472F",prop:"wave",accent:"#D9472F",open:true},82,98,.62)}
        ${person({skin:4,hair:"pony",hairColor:"#B5651D",shirt:"#F39A2B",headphones:true,hp:"#6141D4"},166,100,.6)}`);
      case "calm": return wrap(`<path d="M0 120 C40 104 80 132 120 116 C160 100 200 128 240 112 V150 H0Z" fill="#0B857A" opacity=".25"/>
        <path d="M20 40 C40 30 60 50 80 40 M160 30 C180 20 200 40 220 30" stroke="#0B857A" stroke-opacity=".5" stroke-width="3" fill="none" stroke-linecap="round"/>
        <circle cx="196" cy="62" r="18" fill="#fff" opacity=".7"/>
        ${person({skin:1,hair:"long",hairColor:"#1B1B1F",shirt:"#0B857A",headphones:true,hp:"#6141D4",calm:true,prop:"plant"},120,96,.66)}`);
      case "spark": return wrap(`${spark(30,30,12,"#F5C935")}${spark(214,26,10,"#FF7C66")}${spark(200,120,8,"#3FCABB")}${spark(40,110,7,"#A48EFF")}
        ${person({skin:4,hair:"curly",hairColor:"#B5651D",shirt:"#6141D4",prop:"sketch",accent:"#6141D4",glasses:true},80,98,.6)}
        ${person({skin:0,hair:"locs",hairColor:"#1B1B1F",shirt:"#F5B82E",prop:"controller",open:true},168,100,.6)}`);
      case "learn": return wrap(`<g><circle cx="196" cy="40" r="22" fill="#fff"/><text x="196" y="50" text-anchor="middle" font-family="Unbounded, system-ui, sans-serif" font-size="28" font-weight="800" fill="#B97F00">?</text></g>
        <g transform="translate(30 22)"><circle cx="12" cy="12" r="12" fill="#F5C935"/><rect x="6" y="24" width="12" height="8" rx="2" fill="#B97F00"/></g>
        ${person({skin:2,hair:"short",hairColor:"#1B1B1F",shirt:"#B97F00",glasses:true,prop:"book",accent:"#0B857A"},90,98,.62)}
        ${person({skin:5,hair:"bun",hairColor:"#D9A441",shirt:"#2F6FB5",prop:"laptop",accent:"#F5B82E",lanyard:true},170,100,.6)}`);
    }
    return "";
  }
  function session(kind){
    const cl=id("sc");
    const wrap = (bg,inner) => `<svg viewBox="0 0 120 120" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><defs><clipPath id="${cl}"><rect width="120" height="120"/></clipPath></defs><g clip-path="url(#${cl})"><rect width="120" height="120" fill="${bg}"/>${inner}</g></svg>`;
    if(/talk/i.test(kind)) return wrap("#6141D4",`<rect x="64" y="12" width="48" height="18" rx="5" fill="#E8453C"/><text x="88" y="25" text-anchor="middle" font-family="Unbounded, system-ui, sans-serif" font-size="8.5" font-weight="700" fill="#fff">ON AIR</text>${spark(20,22,7,"#F5C935")}${person({skin:2,hair:"short",hairColor:"#1B1B1F",shirt:"#F5B82E",prop:"mic",open:true},62,78,.5)}`);
    if(/q&a|q&amp;a|qa/i.test(kind)) return wrap("#B97F00",`<circle cx="92" cy="28" r="16" fill="#fff"/><text x="92" y="36" text-anchor="middle" font-family="Unbounded, system-ui, sans-serif" font-size="20" font-weight="800" fill="#B97F00">?</text>${person({skin:4,hair:"long",hairColor:"#6B3E1F",shirt:"#0B857A",glasses:true,prop:"book",accent:"#6141D4"},54,80,.5)}`);
    if(/circle|support/i.test(kind)) return wrap("#0B857A",`<ellipse cx="60" cy="112" rx="52" ry="14" fill="#fff" opacity=".25"/>${person({skin:0,hair:"locs",hairColor:"#1B1B1F",shirt:"#D9472F",calm:true},28,86,.34)}${person({skin:5,hair:"bun",hairColor:"#5A2A82",shirt:"#F5B82E",headphones:true,hp:"#6141D4"},92,86,.34)}${person({skin:3,hair:"hijab",scarf:"#A48EFF",shirt:"#2F6FB5",prop:"heart"},60,76,.42)}`);
    return wrap("#D9472F",`${spark(98,22,8,"#F5C935")}${person({skin:3,hair:"curly",hairColor:"#2B1A12",shirt:"#6141D4",prop:"laptop",accent:"#3FCABB",headphones:true,hp:"#F5B82E"},60,78,.5)}`);
  }
  function stage(){
    const g=id("sg"),cl=id("st");
    return `<svg viewBox="0 0 640 220" preserveAspectRatio="xMidYMid slice" role="img" aria-label="Illustration of a live talk show: a host with a microphone and a guest on stage, an audience of autistic people listening"><defs>${specGrad(g)}<clipPath id="${cl}"><rect width="640" height="220"/></clipPath></defs><g clip-path="url(#${cl})">
      <rect width="640" height="220" fill="#141830"/>
      <path d="M0 0 L120 0 L60 220 L0 220Z M640 0 L520 0 L580 220 L640 220Z" fill="#6141D4" opacity=".35"/>
      <rect x="230" y="24" width="180" height="70" rx="10" fill="#1F2445" stroke="url(#${g})" stroke-width="3"/>
      <text x="320" y="56" text-anchor="middle" font-family="Unbounded, system-ui, sans-serif" font-size="15" font-weight="800" fill="#fff">AUTISTIK LIVE</text>
      <text x="320" y="78" text-anchor="middle" font-family="Atkinson Hyperlegible, system-ui, sans-serif" font-size="11" fill="#C6CBE3">talks · Q&amp;As · support circles</text>
      <rect x="0" y="176" width="640" height="44" fill="#F5B82E" opacity=".18"/>
      ${spark(160,40,9,"#F5C935")}${spark(486,48,8,"#3FCABB")}
      ${person({skin:2,hair:"short",hairColor:"#1B1B1F",shirt:"#D9472F",prop:"mic",open:true},236,150,.62)}
      ${person({skin:4,hair:"long",hairColor:"#6B3E1F",shirt:"#0B857A",lanyard:true,glasses:true},404,150,.62)}
      ${person({skin:0,hair:"afro",hairColor:"#1B1B1F",shirt:"#6141D4",headphones:true,hp:"#F5B82E"},70,200,.5)}
      ${person({skin:5,hair:"bun",hairColor:"#D9A441",shirt:"#F39A2B"},140,206,.44)}
      ${person({skin:1,hair:"hijab",scarf:"#A48EFF",shirt:"#2F6FB5"},500,204,.46)}
      ${person({skin:3,hair:"curly",hairColor:"#2B1A12",shirt:"#D9472F",headphones:true,hp:"#3FCABB"},578,200,.5)}
      </g></svg>`;
  }
  const PEOPLE = {
    artist:{skin:4,hair:"long",hairColor:"#6B3E1F",shirt:"#6141D4",prop:"sketch",accent:"#D9472F"},
    coder:{skin:0,hair:"short",hairColor:"#1B1B1F",shirt:"#0B857A",glasses:true,prop:"laptop",accent:"#F5B82E",headphones:true,hp:"#6141D4"},
    gamer:{skin:2,hair:"locs",hairColor:"#1B1B1F",shirt:"#F5B82E",prop:"controller",open:true},
    advocate:{skin:1,hair:"hijab",scarf:"#D9472F",shirt:"#2F6FB5",prop:"mic",open:true,lanyard:true},
    reader:{skin:5,hair:"bun",hairColor:"#5A2A82",shirt:"#D9472F",glasses:true,prop:"book",accent:"#0B857A",pin:true},
    gardener:{skin:3,hair:"buzz",hairColor:"#8E8E99",shirt:"#3F7F2F",older:true,prop:"plant",calm:true},
  };
  function portrait(key, bg){
    const cl=id("pc");
    return `<svg viewBox="0 0 140 150" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><defs><clipPath id="${cl}"><rect width="140" height="150"/></clipPath></defs><g clip-path="url(#${cl})"><rect width="140" height="150" fill="${bg}"/><circle cx="70" cy="64" r="52" fill="#fff" opacity=".18"/>${person(PEOPLE[key],70,76,.58)}</g></svg>`;
  }
  /* AI companions */
  function believer(){
    const g=id("bg"), r=id("br");
    let rays=""; for(let i=0;i<12;i++){ rays+=`<rect x="47" y="2" width="6" height="14" rx="3" fill="#FFC94A" transform="rotate(${i*30} 50 50)"/>`; }
    return `<svg viewBox="0 0 100 100" role="img" aria-label="Believer, a sunny AI companion"><defs><linearGradient id="${g}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFD25E"/><stop offset="1" stop-color="#FF6B4A"/></linearGradient><radialGradient id="${r}" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#fff" stop-opacity=".55"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/></radialGradient></defs>
      ${rays}<circle cx="50" cy="52" r="33" fill="url(#${g})"/><circle cx="50" cy="52" r="33" fill="url(#${r})"/>
      <path d="M50 19 V10" stroke="#FF6B4A" stroke-width="3" stroke-linecap="round"/>${spark(50,8,6,"#fff")}
      <ellipse cx="38" cy="48" rx="7" ry="8.5" fill="#fff"/><ellipse cx="62" cy="48" rx="7" ry="8.5" fill="#fff"/>
      <circle cx="39" cy="46" r="4" fill="#2A1A3E"/><circle cx="63" cy="46" r="4" fill="#2A1A3E"/><circle cx="40.5" cy="44.5" r="1.4" fill="#fff"/><circle cx="64.5" cy="44.5" r="1.4" fill="#fff"/>
      <path d="M37 62 Q50 76 63 62" stroke="#2A1A3E" stroke-width="3.4" fill="#fff" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="28" cy="60" r="5" fill="#FF6B4A" opacity=".5"/><circle cx="72" cy="60" r="5" fill="#FF6B4A" opacity=".5"/></svg>`;
  }
  function purity(){
    const g=id("pg"), r=id("pr");
    return `<svg viewBox="0 0 100 100" role="img" aria-label="Purity, a calm AI companion"><defs><linearGradient id="${g}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5FE0CF"/><stop offset="1" stop-color="#8B6BFF"/></linearGradient><radialGradient id="${r}" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#fff" stop-opacity=".55"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/></radialGradient></defs>
      <ellipse cx="50" cy="13" rx="20" ry="5" fill="none" stroke="#B8A8FF" stroke-width="3"/>
      <path d="M50 20 C70 20 84 36 84 56 C84 76 69 90 50 90 C31 90 16 76 16 56 C16 36 30 20 50 20 Z" fill="url(#${g})"/><path d="M50 20 C70 20 84 36 84 56 C84 76 69 90 50 90 C31 90 16 76 16 56 C16 36 30 20 50 20 Z" fill="url(#${r})"/>
      <path d="M50 20 C48 12 54 8 60 8 C58 14 54 18 50 20 Z" fill="#3DB66A"/>
      <path d="M32 54 Q38 60 44 54 M56 54 Q62 60 68 54" stroke="#1E1B3A" stroke-width="3.2" fill="none" stroke-linecap="round"/>
      <path d="M42 68 Q50 74 58 68" stroke="#1E1B3A" stroke-width="3" fill="none" stroke-linecap="round"/>
      <circle cx="28" cy="64" r="5" fill="#fff" opacity=".35"/><circle cx="72" cy="64" r="5" fill="#fff" opacity=".35"/>
      ${spark(86,26,5,"#fff")}${spark(14,34,4,"#fff")}</svg>`;
  }
  return {hero, group, session, stage, portrait, believer, purity, PEOPLE};
})();
export default ART;

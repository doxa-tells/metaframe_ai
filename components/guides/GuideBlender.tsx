import { withBase } from "@/lib/base";
import { creditsFor, creditsWord, formatCredits } from "@/lib/credits";
import { PACKAGES, formatTenge } from "@/lib/packages";
import { CopyBlock } from "./CopyBlock";

// Гайд «Тулпар над Байтереком»: как собрать киношную сцену через Blender + Claude Code + Seedance.
// Шаги 1–3 открыты всем. Шаги 4–7 сервер отдаёт только вошедшим (full): без входа их нет в ответе вовсе.
type Lang = "ru" | "en";
const A = (f: string) => withBase(`/assets/guides/blender/${f}`);

// ── Промпты. Английские — как есть в обеих версиях: модели понимают их точнее. ──
const P_CREATURE = `Ultra-realistic film still of a winged horse made of hammered gold: the whole body, mane, tail and feathered wings are beaten gold with visible hammer marks and fine scratches. Full body in frame, three-quarter side view, wings half spread, standing in fresh snow. Heavy snowfall, breath steaming from the nostrils. Cold teal-blue overcast background with nothing else in it. Soft diffused daylight, real metal reflections, shallow depth of field, 35mm film look, fine grain. No rider, no saddle, no text.`;

const P_FACE = `Use the man in my photos. Keep his face exactly: same facial features, proportions, skin texture, hair and beard. Do not beautify him or change his age.
Ultra-realistic studio character sheet on a neutral grey background, soft even light. Three head-and-shoulders portraits of the same man in one row: face straight to camera, left profile, right profile. Neutral expression, mouth closed, eyes open. He wears a dark wrap robe with a thick fur collar. Sharp focus, real skin pores and stubble, no retouching, no text.`;

const P_COSTUME = `Ultra-realistic studio costume reference on a neutral grey background, soft even light. The same outfit shown three times in one row, full body down to the boots: front view, side view, back view. Long brown felt coat with a thick fur collar and embroidered trim, dark wrap robe and leather belt underneath, loose dark trousers, worn leather boots. Standing straight, arms relaxed at the sides.
The face must not be visible in any view: cover the head from the collar up with a flat grey rectangle of the same colour as the background. No facial features anywhere in the image. Real fabric texture and stitching, sharp focus, no text.`;

const P_KEYFRAME = `Image 1 is the man: his face and costume. Image 2 is the winged golden horse. Image 3 is only a colour and lighting reference.
Ultra-realistic film still: the man from Image 1 sits astride the horse from Image 2. Medium shot, three-quarter view, one hand in the mane, looking past the camera. Keep his face and the horse exactly as in the references.
Take from Image 3 only the palette, the weather and the light: cold teal-blue blizzard dusk, falling snow, gold as the only warm colour. Do not copy its composition, people or objects.
Shallow depth of field, natural skin texture, 35mm film look, fine grain. No text.`;

const P_INSTALL_MAC = `curl -LsSf https://www.mcp-for-blender.com/install.sh | sh`;
const P_INSTALL_WIN = `irm https://www.mcp-for-blender.com/install.ps1 | iex`;

const P_PREVIZ_RU = `Сделай в Blender 3D-превиз для ИИ-видео: 25 секунд, вертикальный 9:16, один непрерывный кадр.
Камера динамично пикирует с верхнего угла к герою: я сижу на пегасе на верхушке Байтерека. Подлетают духи и нападают по очереди, я уклоняюсь от каждого. Потом налетают сотни духов и собираются в клубок вокруг меня, камера эпично отлетает. Я резко начинаю сиять, и шар Байтерека тоже.
Всё простыми фигурами, без детализации: герой — один цилиндр, конь — одна коробка, духи — тёмные капли. Без рук, ног и лиц. Каждому свой цвет. Чистый рендер без смаза движения и текстур.
Киношно: плавная камера, малая глубина резкости, перевод фокуса.
Прежде чем начать, спроси, что тебе от меня нужно.`;

const P_PREVIZ_EN = `Build a 3D previs in Blender for an AI video: 25 seconds, vertical 9:16, one continuous shot.
The camera dives from a high angle toward the hero: I am sitting on a winged horse on top of the Baiterek tower. Wraiths fly in and attack one at a time, I dodge each one. Then hundreds of wraiths close in and form a ball around me while the camera pulls back wide. I suddenly start to glow, and so does the tower's sphere.
Simple shapes only, no detail: the hero is one cylinder, the horse is one box, the wraiths are dark teardrops. No arms, legs or faces. One flat colour per character. Clean render, no motion blur, no textures.
Cinematic: smooth camera, shallow depth of field, focus pulls.
Before you start, ask me what you need from me.`;

const P_SEEDANCE = `@Video 1 is a grey 3D blockout. It defines the camera position and movement, the framing, the flight paths, the staging and the pacing. Do not use its materials, colours, flat lighting or empty look. In it the red cylinder is the rider, the white box is his winged horse, the dark teardrops are the wraiths, the gold ball on a white stem is Baiterek tower, the grey boxes are the city, and the two glowing balls at the end mark bursts of light, not objects. The shapes move rigidly: follow their paths and turns, but give the rider, the horse and the wraiths natural living body motion.

The rider corresponds to @Image 1. Use only his facial features, hair and beard. His clothing is defined by @Image 2. The tulpar corresponds to @Image 4: a horse of hammered gold with feathered golden wings. The wraiths correspond to @Image 7 for the face and @Image 8 for the full figure. Baiterek tower corresponds to @Image 5. The city layout follows @Image 6, covered in snow. @Image 3 defines the colour grade, weather and mood: cold teal-blue blizzard dusk, falling snow, gold as the only warm colour.

Photorealistic live-action film, one continuous shot.

0-2 seconds: The shot opens high in the sky far above the tower, looking down at the whole snowbound city. The rider on the tulpar is a tiny figure on top of the Baiterek sphere. The camera dives fast straight toward him.

2-3 seconds: The dive arrives close in front of his face at the exact instant a wraith lunges at him from behind. He is already twisting to look back, and the tulpar leaps off the sphere with a hard wing beat.

3-12 seconds: He flies around the sphere with the camera flying backward in front of him. Dark wraiths streak in from behind one at a time, each passing within arm's reach, and he dodges every one with a sharp, sudden move: at 4 seconds a barrel roll to the left, at 6 seconds a steep climb and flip over the wraith, at 8 seconds a sudden drop under it, at 9 seconds a barrel roll to the right, at 11 seconds a tight loop up and away. Between dodges he glances back, eyes tracking each wraith, one hand in the mane, breath steaming. From 11 seconds, as the swarm closes in and the camera is close on his face, his eyes light up with a cold electric blue glow.

12-19 seconds: Hundreds of dark wraiths close in from all sides. His eyes still glowing blue, he raises an arm over his face as they wrap him and the tulpar in a dense churning black ball above the sphere. The ball tightens. The wraiths stay dark and matte; they give off no light.

19-25 seconds: He erupts in white-gold light from inside the ball. The ball bursts and the wraiths are thrown outward as dark shapes, crumbling into black ash and cold smoke that thins out and vanishes; they never glow, spark or burn. Two seconds later the Baiterek sphere ignites with the same light. He lowers his arm and straightens, chest heaving. End state: rider and tulpar hover radiant above the glowing sphere, wings spread, snow falling through the light.

Motion has real weight. Wings beat with full strokes; the coat, fur collar, hair, mane and tail whip and lag behind every turn; wraith cloth trails frost vapour; snow streaks past with speed. He stays seated, gripping the horse through every manoeuvre.

Shallow depth of field, natural motion blur, fine film grain, volumetric snow haze. Keep the rider as the same continuous person throughout, with no cuts, slow motion or on-screen text.`;

function Shot({ src, cap, tall }: { src: string; cap: string; tall?: boolean }) {
  return (
    <figure className={`gd-shot${tall ? " tall" : ""}`}>
      <img src={A(src)} alt="" loading="lazy" />
      <figcaption>{cap}</figcaption>
    </figure>
  );
}

export function GuideBlender({ lang, full }: { lang: Lang; full: boolean }) {
  const T = (ru: string, en: string) => (lang === "ru" ? ru : en);
  const copy = { copyLabel: T("Скопировать", "Copy"), doneLabel: T("Скопировано", "Copied") };
  const q = lang === "en" ? "?lang=en" : "";
  const price = (duration: number, resolution: string) =>
    creditsFor({ modelId: "seedance-2.5", modeId: "reference", prompt: "", params: { duration, resolution }, inputs: {} });
  const perCredit = PACKAGES.map((p) => p.price / p.credits);
  const tenge = (c: number) => `${formatTenge(Math.round((c * Math.min(...perCredit)) / 100) * 100)}–${formatTenge(Math.round((c * Math.max(...perCredit)) / 100) * 100)}`;
  const cr = (c: number) => (lang === "ru" ? `${formatCredits(c)} ${creditsWord(c)}` : `${c} credits`);

  const Step = ({ n, kicker, title, children }: { n: number; kicker: string; title: string; children: React.ReactNode }) => (
    <section className="gd-step" id={`step-${n}`}>
      <div className="gd-step-head">
        <span className="gd-num">{String(n).padStart(2, "0")}</span>
        <div>
          <div className="gd-kicker">{kicker}</div>
          <h2>{title}</h2>
        </div>
      </div>
      {children}
    </section>
  );

  return (
    <div className="gd">
      <header className="gd-top">
        <a className="gd-logo" href={withBase("/image")}><img src={withBase("/assets/logo-bright.webp")} alt="" /> MetaFrame Studio</a>
        <nav>
          <a href={withBase("/guides") + q}>{T("Гайды", "Guides")}</a>
          <a className={lang === "ru" ? "on" : ""} href={withBase("/guides/blender")}>RU</a>
          <a className={lang === "en" ? "on" : ""} href={withBase("/guides/blender?lang=en")}>EN</a>
        </nav>
      </header>

      <section className="gd-hero">
        <div className="gd-hero-text">
          <div className="gd-kicker">{T("Гайд · Blender + Claude Code + Seedance", "Guide · Blender + Claude Code + Seedance")}</div>
          <h1>{T("Тулпар над Байтереком", "A winged horse over Baiterek")}</h1>
          <p className="gd-lead">{T(
            "Как собрать киношную сцену с собой в главной роли. Навыки 3D не нужны: сцену в Blender строит Claude по твоему описанию, а Seedance превращает серые фигурки в кино.",
            "How to build a cinematic shot with yourself as the hero. No 3D skills needed: Claude builds the Blender scene from your description, and Seedance turns the grey shapes into film.",
          )}</p>
          <div className="gd-facts">
            <span>{T("7 шагов", "7 steps")}</span><span>{T("25 секунд видео", "25 seconds of video")}</span><span>{T("один непрерывный кадр", "one continuous shot")}</span>
          </div>
        </div>
        <div className="gd-pair">
          <Shot tall src="pv_76.jpg" cap={T("Превиз из Blender: серые фигуры, камера, тайминг", "Blender previs: grey shapes, camera, timing")} />
          <Shot tall src="fin_76.jpg" cap={T("Результат Seedance на той же секунде", "Seedance result at the same second")} />
        </div>
      </section>

      <section className="gd-idea">
        <h2>{T("Идея за минуту: сначала движение на кубиках, потом красота", "The idea in a minute: motion on boxes first, beauty second")}</h2>
        <p>{T(
          "Нейросеть для видео рисует красиво, но плохо слушается: камера летит не туда, герой делает не то. Поэтому движение мы показываем ей заранее на простых фигурах. Это называется превиз. Как всё выглядит, объясняем картинками и текстом.",
          "A video model paints beautifully but follows directions badly: the camera drifts, the hero does the wrong thing. So we show it the motion in advance on simple shapes. That is a previs. What everything looks like comes from images and text.",
        )}</p>
        <div className="gd-flow">
          {[
            [T("Образы", "Looks"), T("существо, ты, враги — по картинке на каждого", "creature, you, enemies: one image each")],
            [T("Ключевой кадр", "Key frame"), T("свет, цвет и погода", "light, colour and weather")],
            [T("Превиз", "Previs"), T("Blender + Claude: камера и тайминг", "Blender + Claude: camera and timing")],
            [T("Промпт", "Prompt"), T("кто есть кто и что происходит по секундам", "who is who and what happens, second by second")],
            [T("Генерация", "Generation"), T("Seedance, потом правки текстом", "Seedance, then fixes in text")],
          ].map(([a, b], i) => (
            <div key={i} className="gd-flow-item"><b>{a}</b><span>{b}</span></div>
          ))}
        </div>
      </section>

      <section className="gd-paths">
        <div className="gd-path">
          <div className="gd-kicker">{T("Путь А · 10 минут", "Path A · 10 minutes")}</div>
          <h3>{T("Повторить тренд с нашим движением", "Repeat the trend with our motion")}</h3>
          <p>{T(
            "Blender ставить не нужно. Берёшь наш готовый превиз, добавляешь свои картинки из шагов 1–3 и наш промпт.",
            "No Blender needed. Take our finished previs, add your own images from steps 1–3 and our prompt.",
          )}</p>
          <video className="gd-video" src={A("previz-25s.mp4")} poster={A("pv_26.jpg")} controls muted playsInline preload="none" />
          <table className="gd-price">
            <thead><tr><th>{T("Версия", "Version")}</th><th>720p</th><th>1080p</th></tr></thead>
            <tbody>
              <tr><td>{T("Короткая, 13 с (бой с духами)", "Short, 13 s (the dodge fight)")}</td><td>{cr(price(13, "720p"))}</td><td>{cr(price(13, "1080p"))}</td></tr>
              <tr><td>{T("Полная, 25 с", "Full, 25 s")}</td><td>{cr(price(25, "720p"))}</td><td>{cr(price(25, "1080p"))}</td></tr>
            </tbody>
          </table>
          {lang === "ru" && <p className="gd-note">{`Полная версия в 720p — это примерно ${tenge(price(25, "720p"))} в зависимости от пакета. За неудачную генерацию кредиты возвращаются.`}</p>}
          {lang === "en" && <p className="gd-note">Credits are returned automatically if a generation fails.</p>}
          <div className="gd-actions">
            <a className="btn accent big" href={withBase("/video")}>{T("Открыть Seedance в студии", "Open Seedance in the Studio")}</a>
            <a className="btn big" href={A("previz-25s.mp4")} download>{T("Скачать превиз, 25 с", "Download previs, 25 s")}</a>
            <a className="btn big" href={A("previz-part1.mp4")} download>{T("Скачать короткий, 13 с", "Download short, 13 s")}</a>
          </div>
          <ol className="gd-mini">
            <li>{T("Сделай свои картинки по шагам 1–3 ниже.", "Make your images with steps 1–3 below.")}</li>
            <li>{T("В студии открой Видео → Seedance 2.5 → «Промпт и референсы».", "In the Studio open Video → Seedance 2.5 → “Prompt and references”.")}</li>
            <li>{T("Загрузи превиз как видео и картинки по порядку из шага 6.", "Upload the previs as the video and the images in the order from step 6.")}</li>
            <li>{T("Вставь промпт из шага 6, поставь длительность как у превиза и 9:16.", "Paste the prompt from step 6, set the duration to match the previs and 9:16.")}</li>
          </ol>
        </div>
        <div className="gd-path">
          <div className="gd-kicker">{T("Путь Б · вечер", "Path B · one evening")}</div>
          <h3>{T("Собрать свою сцену с нуля", "Build your own scene from scratch")}</h3>
          <p>{T(
            "Своя идея, своя камера, своё место. Семь шагов ниже: первые три про картинки, остальные про Blender, Claude и Seedance.",
            "Your idea, your camera, your location. Seven steps below: the first three are about images, the rest about Blender, Claude and Seedance.",
          )}</p>
          <ul className="gd-need">
            <li><b>Blender</b><span>{T("бесплатная 3D-программа, руками в ней ничего делать не придётся", "free 3D app; you will not touch it by hand")}</span></li>
            <li><b>Claude, {T("вкладка Code", "the Code tab")}</b><span>{T("приложение для компьютера, нужен платный план", "desktop app, needs a paid plan")}</span></li>
            <li><b>MCP for Blender</b><span>{T("бесплатный мостик между Claude и Blender, ставится одной командой", "free bridge between Claude and Blender, one command to install")}</span></li>
            <li><b>Seedance 2.5</b><span>{T("модель для видео, есть в этой студии", "the video model, available in this Studio")}</span></li>
            <li><b>{T("Нейросеть для картинок", "An image model")}</b><span>{T("любая, что работает по твоим фото; в студии это Nano Banana", "any that works from your photos; in the Studio it is Nano Banana")}</span></li>
          </ul>
        </div>
      </section>

      <Step n={1} kicker={T("Образ существа", "The creature")} title={T("Создай тулпара", "Make the winged horse")}>
        <div className="gd-cols">
          <div>
            <p>{T(
              "Одна картинка, на которой существо видно целиком. Это его паспорт: видео-модель сверяется с ней в каждом кадре.",
              "One image that shows the whole creature. It is its passport: the video model checks every frame against it.",
            )}</p>
            <ul>
              <li>{T("Весь силуэт в кадре, сбоку или в три четверти.", "Whole silhouette in frame, side or three-quarter view.")}</li>
              <li>{T("Простой фон без других объектов.", "Plain background with nothing else in it.")}</li>
              <li>{T("Материал называй конкретно: «чеканное золото», а не «красивый».", "Name the material exactly: “hammered gold”, not “beautiful”.")}</li>
            </ul>
            <CopyBlock text={P_CREATURE} label={T("Промпт для картинки", "Image prompt")} {...copy} />
          </div>
          <Shot src="ref_tulpar.jpg" cap={T("Наш тулпар: конь из чеканного золота", "Our tulpar: a horse of hammered gold")} />
        </div>
      </Step>

      <Step n={2} kicker={T("Образ героя", "The hero")} title={T("Создай себя: лицо отдельно, костюм отдельно", "Make yourself: face and costume separately")}>
        <p>{T(
          "Главное правило: лицо живёт только на крупном плане, а на картинках в полный рост лица быть не должно. Если на фигуре в полный рост есть маленькое нечёткое лицо, Seedance начнёт сверяться и с ним, и герой в видео «поплывёт».",
          "The main rule: the face lives only in the close-up, and full-body images must have no face. If a full-body figure carries a small soft face, Seedance starts checking against it too and the hero drifts.",
        )}</p>
        <div className="gd-cols">
          <div>
            <h4>{T("2.1. Лицо", "2.1. Face")}</h4>
            <p>{T("Загрузи два-три своих фото при ровном свете и попроси три портрета: анфас и оба профиля.", "Upload two or three photos of yourself in even light and ask for three portraits: front and both profiles.")}</p>
            <CopyBlock text={P_FACE} label={T("Промпт: лист лица", "Prompt: face sheet")} {...copy} />
          </div>
          <Shot src="ref_face_front.jpg" cap={T("Лицо анфас — отдельным файлом", "Face, front view, as its own file")} tall />
        </div>
        <div className="gd-cols">
          <div>
            <h4>{T("2.2. Костюм в полный рост, без лица", "2.2. Costume, full body, no face")}</h4>
            <p>{T("Тот же человек, но голова закрыта серым прямоугольником. Так модель берёт отсюда только одежду и пропорции.", "The same person, but the head is covered by a grey rectangle. The model takes only clothing and proportions from here.")}</p>
            <CopyBlock text={P_COSTUME} label={T("Промпт: костюм без лица", "Prompt: costume without a face")} {...copy} />
          </div>
          <Shot src="ref_costume_front.jpg" cap={T("Костюм спереди: лица нет", "Costume, front view: no face")} tall />
        </div>
        <Shot src="ref_sheet.jpg" cap={T("Наш лист персонажа целиком: лицо крупно, фигуры без лица", "Our full character sheet: face in close-up, figures without a face")} />
        <p className="gd-note">{T(
          "Потом разрежь листы: одна картинка — один ракурс. Мы взяли в работу лицо анфас и костюм спереди. Короткая сторона файла — не меньше 300 пикселей, иначе загрузка выдаст ошибку.",
          "Then cut the sheets apart: one image, one angle. We used the front face and the front costume. Keep the short side at 300 px or more, or the upload fails.",
        )}</p>
      </Step>

      <Step n={3} kicker={T("Ключевой кадр", "The key frame")} title={T("Поставь героя в киношную сцену", "Put the hero into a film frame")}>
        <div className="gd-cols">
          <div>
            <p>{T(
              "Найди кадр, в котором тебе нравятся свет и цвет. Сюжет не важен, нужно настроение. Потом попроси нейросеть посадить героя на существо в этой атмосфере.",
              "Find a frame whose light and colour you like. The story does not matter, only the mood. Then ask the image model to seat your hero on the creature in that atmosphere.",
            )}</p>
            <CopyBlock text={P_KEYFRAME} label={T("Промпт: ключевой кадр", "Prompt: key frame")} {...copy} />
            <p className="gd-note">{T(
              "В видео этот кадр отвечает только за цвет, погоду и настроение. Лицо и костюм модель возьмёт из картинок шага 2. Так роли не путаются.",
              "In the video this frame is responsible only for colour, weather and mood. Face and costume come from the images of step 2, so the roles never mix.",
            )}</p>
          </div>
          <Shot src="ref_scene.jpg" cap={T("Наш ключевой кадр: холодная бирюза, снег, золото как единственный тёплый цвет", "Our key frame: cold teal, snow, gold as the only warm colour")} />
        </div>
        <p>{T(
          "Тем же способом сделай остальных участников и место. У нас это духи (крупный план и фигура в полный рост), фото Байтерека зимой и панорама города сверху.",
          "Make the other characters and the location the same way. Ours are the wraiths (a close-up and a full figure), a winter photo of the tower and a city panorama from above.",
        )}</p>
        <div className="gd-cols even">
          <Shot src="ref_wraith.jpg" cap={T("Дух, крупный план", "Wraith, close-up")} />
          <Shot src="ref_wraith_sheet.jpg" cap={T("Духи в полный рост", "Wraiths, full figure")} />
        </div>
      </Step>

      {!full && (
        <section className="gd-gate">
          <div className="gd-gate-fade" />
          <div className="gd-gate-box">
            <div className="gd-kicker">{T("Дальше — бесплатно после входа", "The rest is free after sign-in")}</div>
            <h2>{T("Шаги 4–7: Blender, Claude и финальный промпт", "Steps 4–7: Blender, Claude and the final prompt")}</h2>
            <ul>
              <li>{T("Установка Blender, Claude Code и мостика одной командой", "Installing Blender, Claude Code and the bridge with one command")}</li>
              <li>{T("Наш промпт, по которому Claude собрал сцену, и шесть правил фигурок", "The prompt Claude built our scene from, plus six rules for the shapes")}</li>
              <li>{T("Что и в каком порядке загружать в Seedance", "What to upload to Seedance and in what order")}</li>
              <li>{T("Финальный промпт целиком, по секундам", "The complete final prompt, second by second")}</li>
              <li>{T("Как дописывать промпт после первой генерации", "How to fix the prompt after the first generation")}</li>
            </ul>
            <a className="btn accent big" href={withBase("/guides/blender/full") + q}>{T("Войти бесплатно и читать дальше", "Sign in free and keep reading")}</a>
            <p className="gd-note">{T("Вход через Google — один клик. Карта не нужна.", "Google sign-in takes one click. No card needed.")}</p>
          </div>
        </section>
      )}

      {full && (
        <>
          <Step n={4} kicker={T("Установка, 15 минут", "Setup, 15 minutes")} title={T("Подключи Claude к Blender", "Connect Claude to Blender")}>
            <ol className="gd-ol">
              <li><b>Blender.</b> {T("Скачай с blender.org/download и установи как обычную программу. Открой один раз, чтобы он создал свои папки.", "Download from blender.org/download and install it like any app. Open it once so it creates its folders.")}</li>
              <li><b>Claude.</b> {T("Скачай приложение с claude.com/download, войди в аккаунт и открой вкладку Code. Это и есть Claude Code: он умеет запускать программы на твоём компьютере.", "Download the app from claude.com/download, sign in and open the Code tab. That is Claude Code: it can run programs on your computer.")}</li>
              <li><b>MCP for Blender.</b> {T("Открой Терминал и вставь одну команду. Она сама найдёт Claude и поставит дополнение в Blender.", "Open Terminal and paste one command. It finds Claude and installs the add-on into Blender.")}</li>
            </ol>
            <CopyBlock text={P_INSTALL_MAC} label="macOS / Linux" {...copy} />
            <CopyBlock text={P_INSTALL_WIN} label="Windows, PowerShell" {...copy} />
            <p>{T(
              "После этого полностью закрой Claude и открой снова, затем запусти Blender. Проверка: напиши Claude «Что сейчас в сцене Blender?». Если он перечислил куб, камеру и свет, всё работает.",
              "Then quit Claude completely and reopen it, and start Blender. To check, ask Claude “What is in the Blender scene right now?”. If it lists a cube, a camera and a light, everything works.",
            )}</p>
            <p className="gd-note">{T(
              "Не подключилось: в Blender открой Edit → Preferences → Add-ons, включи «Interface: MCP for Blender» и перезапусти Claude. MCP for Blender — сторонний бесплатный проект с открытым кодом, его делает не команда Blender.",
              "Not connected: in Blender open Edit → Preferences → Add-ons, enable “Interface: MCP for Blender” and restart Claude. MCP for Blender is a free third-party open-source project, not made by the Blender team.",
            )}</p>
          </Step>

          <Step n={5} kicker={T("Превиз", "Previs")} title={T("Опиши сцену Claude словами", "Describe the scene to Claude in words")}>
            <div className="gd-cols">
              <div>
                <p>{T(
                  "Пиши так, как рассказал бы оператору: откуда летит камера, что делает герой, чем всё заканчивается. Claude построит сцену, анимирует и отрендерит ролик.",
                  "Write the way you would brief a camera operator: where the camera comes from, what the hero does, how it ends. Claude builds the scene, animates it and renders the clip.",
                )}</p>
                <CopyBlock text={lang === "ru" ? P_PREVIZ_RU : P_PREVIZ_EN} label={T("Наш промпт для Claude", "Our prompt for Claude")} {...copy} />
              </div>
              <Shot tall src="pv_26.jpg" cap={T("Красный цилиндр — герой, белая коробка — тулпар, тёмные капли — духи", "Red cylinder is the hero, white box is the horse, dark teardrops are the wraiths")} />
            </div>
            <h4>{T("Шесть правил фигурок", "Six rules for the shapes")}</h4>
            <ol className="gd-ol">
              <li>{T("Только простые фигуры. Герой — цилиндр, конь — коробка. Руки, ноги и лица модель скопирует буквально и сломает.", "Simple shapes only. The hero is a cylinder, the horse is a box. Arms, legs and faces get copied literally and break.")}</li>
              <li>{T("Каждому свой цвет, чтобы потом назвать его в промпте.", "One colour per character, so you can name it in the prompt.")}</li>
              <li>{T("Двигай траектории и камеру, а не позы.", "Animate paths and the camera, not poses.")}</li>
              <li>{T("Реальные пропорции места. Не увеличивай героя ради заметности.", "Real proportions of the place. Do not enlarge the hero to make him visible.")}</li>
              <li>{T("Чистый рендер: без смаза движения и текстур.", "Clean render: no motion blur, no textures.")}</li>
              <li>{T("Длина и формат сразу финальные.", "Final length and aspect ratio from the start.")}</li>
            </ol>
            <h4>{T("Правь словами", "Fix it in words")}</h4>
            <p>{T("Первый вариант редко попадает в точку. Смотри ролик и говори, что не так. Наши правки, у нас ушло три версии:", "The first version rarely lands. Watch the clip and say what is wrong. Our notes, it took us three versions:")}</p>
            <ul>
              <li>{T("«Меня сделай цилиндром, коня — прямоугольником».", "“Make me a cylinder and the horse a box.”")}</li>
              <li>{T("«Пусть мы уклоняемся: рывок вправо, влево, вниз или сальто, а не столкновение».", "“We dodge: a jerk right, left, down or a flip, not a collision.”")}</li>
              <li>{T("«Камера пусть снимает спереди, чтобы было видно лицо».", "“Shoot from the front so the face is visible.”")}</li>
              <li>{T("«Шар Байтерека в полтора раза шире, но такой же круглый».", "“Make the tower sphere one and a half times wider, still round.”")}</li>
            </ul>
          </Step>

          <Step n={6} kicker={T("Генерация", "Generation")} title={T("Собери всё в Seedance", "Assemble it in Seedance")}>
            <p>{T(
              "Открой Seedance 2.5 в режиме «Промпт и референсы». Загрузи превиз как видео и картинки по порядку: в промпте ты ссылаешься на них по номерам. Длительность и формат — как у превиза: у нас 25 секунд, 9:16.",
              "Open Seedance 2.5 in “Prompt and references” mode. Upload the previs as the video and the images in order: the prompt refers to them by number. Duration and aspect ratio match the previs: ours is 25 seconds, 9:16.",
            )}</p>
            <table className="gd-table">
              <tbody>
                <tr><td>@Video 1</td><td>{T("Превиз: камера, полёт, тайминг", "Previs: camera, flight, timing")}</td></tr>
                <tr><td>@Image 1</td><td>{T("Лицо анфас", "Face, front view")}</td></tr>
                <tr><td>@Image 2</td><td>{T("Костюм спереди, без лица", "Costume, front view, no face")}</td></tr>
                <tr><td>@Image 3</td><td>{T("Ключевой кадр: цвет, погода, настроение", "Key frame: colour, weather, mood")}</td></tr>
                <tr><td>@Image 4</td><td>{T("Тулпар", "The winged horse")}</td></tr>
                <tr><td>@Image 5</td><td>{T("Башня: фото Байтерека зимой", "The tower: a winter photo")}</td></tr>
                <tr><td>@Image 6</td><td>{T("Планировка города: панорама сверху", "City layout: a panorama from above")}</td></tr>
                <tr><td>@Image 7, 8</td><td>{T("Дух: лицо и фигура целиком", "Wraith: face and full figure")}</td></tr>
              </tbody>
            </table>
            <p className="gd-note">{T(
              "Главная мысль: превиз отвечает за движение, картинки — за внешний вид, текст — за то, что происходит. Скажи об этом модели прямо в первом абзаце, иначе она нарисует серые кубики. Одна картинка — одна роль.",
              "The main idea: the previs owns the motion, the images own the look, the text owns what happens. Say so in the first paragraph or the model will paint grey boxes. One image, one role.",
            )}</p>
            <h4>{T("Из чего состоит промпт", "What the prompt is made of")}</h4>
            <ol className="gd-ol">
              <li>{T("Что такое превиз: что брать из него, что не брать и какая фигура кого обозначает.", "What the previs is: what to take from it, what not to, and which shape is who.")}</li>
              <li>{T("Кто есть кто: по одной фразе на картинку.", "Who is who: one sentence per image.")}</li>
              <li>{T("Действие по секундам: четыре-пять отрезков с целыми секундами. Что видно в кадре, а не «эпично».", "Action by the second: four or five spans in whole seconds. What is in frame, not “epic”.")}</li>
              <li>{T("Физика движения: что развевается, что отстаёт на поворотах, как сидит всадник.", "Motion physics: what flutters, what lags in turns, how the rider sits.")}</li>
              <li>{T("Картинка: оптика, зерно, запреты (без склеек, без текста).", "The picture: optics, grain, bans (no cuts, no text).")}</li>
            </ol>
            <CopyBlock text={P_SEEDANCE} label={T("Наш финальный промпт целиком", "Our complete final prompt")} {...copy} />
            <p className="gd-note">{T(
              "Промпт на английском: так модель точнее понимает детали. Напиши по-русски и попроси Claude перевести и разложить по этой структуре.",
              "Take it as a template: replace the characters and the action, keep the structure.",
            )}</p>
            <div className="gd-actions">
              <a className="btn accent big" href={withBase("/video")}>{T("Открыть Seedance в студии", "Open Seedance in the Studio")}</a>
            </div>
          </Step>

          <Step n={7} kicker={T("Доводка", "Refining")} title={T("Смотри и дописывай", "Watch and add")}>
            <p>{T(
              "Первая генерация почти никогда не идеальна. Не переписывай всё: найди, что именно не так, и добавь одну точную фразу. Нам хватило двух генераций.",
              "The first generation is almost never perfect. Do not rewrite everything: find exactly what is wrong and add one precise sentence. Two generations were enough for us.",
            )}</p>
            <div className="gd-pair wide">
              <Shot tall src="pv_240.jpg" cap={T("Превиз, финал", "Previs, the ending")} />
              <Shot tall src="fin_240.jpg" cap={T("Результат", "Result")} />
              <Shot tall src="pv_165.jpg" cap={T("Превиз, клубок духов", "Previs, the swarm")} />
              <Shot tall src="fin_165.jpg" cap={T("Результат", "Result")} />
            </div>
            <table className="gd-table">
              <tbody>
                <tr><td>{T("Пропало пикирование", "The dive disappeared")}</td><td>{T("Вынесли первые две секунды в отдельный отрезок и описали, что видно в самом начале.", "We gave the first two seconds their own span and described what is visible at the very start.")}</td></tr>
                <tr><td>{T("Духи засветились", "The wraiths started glowing")}</td><td>{T("Запрет написали прямо и дважды: в сцене с клубком и в сцене взрыва.", "We wrote the ban explicitly, twice: in the swarm scene and in the burst scene.")}</td></tr>
                <tr><td>{T("Вертел головой без причины", "He looked around for no reason")}</td><td>{T("Привязали взгляды к действию: оглядывается между уклонениями и следит глазами за каждым духом.", "We tied the glances to the action: he looks back between dodges and tracks each wraith.")}</td></tr>
                <tr><td>{T("Мало уклонений", "Too few dodges")}</td><td>{T("Дали по одному манёвру на конкретную секунду.", "One manoeuvre per specific second.")}</td></tr>
                <tr><td>{T("Понравилась случайность", "A happy accident")}</td><td>{T("У героя сами загорелись глаза. Оставили и закрепили в тексте, с какой секунды. Удачные находки записывай в промпт, иначе в следующей генерации они исчезнут.", "The hero's eyes lit up on their own. We kept it and pinned the second in the text. Write lucky finds into the prompt or they vanish next time.")}</td></tr>
              </tbody>
            </table>
          </Step>

          <section className="gd-end">
            <h2>{T("Теперь твоя очередь", "Your turn")}</h2>
            <p>{T("Начни с картинок из шагов 1–3, а движение возьми наше или собери своё.", "Start with the images from steps 1–3, then use our motion or build your own.")}</p>
            <div className="gd-actions">
              <a className="btn accent big" href={withBase("/image")}>{T("Сделать картинки в студии", "Make the images in the Studio")}</a>
              <a className="btn big" href={withBase("/video")}>{T("Открыть Seedance", "Open Seedance")}</a>
            </div>
          </section>
        </>
      )}

      <footer className="gd-foot">MetaFrame Studio · <a href={withBase("/terms")}>{T("Правила", "Terms")}</a></footer>
    </div>
  );
}

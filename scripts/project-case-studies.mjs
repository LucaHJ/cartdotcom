// Content is grounded in the project source review recorded in the coordination notes.
export const projects = [
  {
    slug: 'gforcesimsim', old: 'GForceSimSim', title: 'G-Force Simulating Centrifuge',
    category: 'Simulation / Desktop draft', stack: 'C# / .NET / WPF / 3D visualisation / Recorded telemetry',
    lead: 'Exploring how a rotating arm, a moving carriage and an orientable seat could reproduce the direction and magnitude of a racing driver\'s apparent G-force.',
    flow: ['Load a lap and its telemetry', 'Convert acceleration into a target vector', 'Solve carriage position and seat orientation', 'Play the rig, track and instruments together'],
    captures: [
      ['rig', 'The centrifuge in motion', 'Screenshot or GIF pending', 'Overview of the rotating arm, moving carriage and three-axis seat.'],
      ['telemetry', 'A lap, synchronised', 'Screenshot or GIF pending', 'Playback with the track marker, racing instruments and force-history cursor visible.'],
      ['vectors', 'Comparing the force vectors', 'Screenshot pending', 'Close-up of the rider and the target and simulated force directions.']
    ],
    sections: [
      ['The Question', [
        'A car produces changing longitudinal and lateral acceleration, while a centrifuge produces a load that depends on its radius and angular speed. This project investigates how those two descriptions can be connected. Rather than simply spinning a model faster whenever a racing car accelerates, it separates the magnitude of the required horizontal load from the orientation in which a seated rider would experience it.',
        'The desktop application makes that mapping inspectable. A three-dimensional rig shows the rotating arm, carriage and yaw/pitch/roll gimbal, while recorded racing data supplies the changing target. Orbit and zoom controls let the same run be examined as an overview or from close to the seat. The result is a visual concept study, not a design certified for construction or human use.'
      ]],
      ['From Files to a Lap', [
        'Recorded telemetry is organised by race, session and driver, with lap-time information providing a way to choose a run. The browser can filter and rank laps using measures such as lap time, peak G and speed. Cached metadata avoids rediscovering the same information every time a folder is revisited.',
        'After selection, the telemetry becomes a common timeline for the rig and the instruments. Longitudinal and lateral acceleration are read from the supplied acc_x and acc_y estimates and converted from metres per second squared to G. The data is treated as recorded evidence, including its omissions: unavailable steering information is shown as missing rather than inferred and presented as a measured signal.'
      ]],
      ['The Force Model', [
        'For the rotating arm, horizontal acceleration follows a = omega squared times r, with angular speed obtained from RPM. The model uses standard gravity, 9.80665 metres per second squared, to express that acceleration in G. Radius changes the horizontal load at a given spin speed; doubling angular speed has a squared effect on acceleration.',
        'Earth gravity remains part of the result. One horizontal G and one vertical G combine to approximately 1.414 G at 45 degrees, not two G. The target therefore includes a constant downward gravity component alongside the two racing acceleration components. The derived vertical acceleration field in the supplied lap data is excluded from this mapping.',
        'Physical acceleration and the apparent loading felt by a supported rider are not interchangeable arrows. Establishing a consistent sign convention was essential: a visually plausible animation can still point the rider in the wrong direction if the physical and apparent vectors are mixed.'
      ]],
      ['Solving the Rig', [
        'The peak horizontal load in the selected lap establishes a constant spin speed at the five-metre end of the arm. Lower loads are then reproduced by moving the carriage inward in proportion to the required horizontal acceleration. This makes the main relationship visible: one lap establishes the rotational operating point, and the changing telemetry determines the carriage position.',
        'A minimum-angle orientation solution adjusts yaw, pitch and roll so the target vector and the simulated rider-relative vector agree. Separating that orientation calculation from load magnitude makes it possible to inspect whether a mismatch comes from the carriage radius, a coordinate transformation or the seat attitude.',
        'This is an idealised mapping. It does not establish that a physical carriage could follow every requested movement, or account for the complete Coriolis, Euler, inertia and structural loads of that movement. Those omissions matter when interpreting the animation.'
      ]],
      ['One Playback Clock', [
        'The seat animation is only useful if it can be compared with the event that caused it. Speed, throttle, brake, gear, engine RPM and lap time accompany the rig. A marker follows the recorded XY track, and a cursor moves through the full-lap G history.',
        'Scrubbing moves all of these views to the same point. A braking zone can therefore be paused and examined against the target load, carriage location and seat orientation, then compared with a corner or straight. The complete lap history gives context that a single instantaneous gauge cannot: it shows whether a movement is a brief spike or part of a sustained section.'
      ]],
      ['What Needed Solving', [
        'The most important debugging work involved coordinate frames and force direction. Left and right in the racing data, the world-space rig and the rider\'s local frame have to remain consistent. Fixing a visual reversal required checking those transformations rather than hiding the problem with a camera adjustment.',
        'The application also needed usable selection and inspection controls. A dropdown contrast problem made choices difficult to read; correcting the control styling was a functional fix, not merely decoration. The cached lap browser and synchronised instruments similarly help expose errors that would be hard to notice in the rig alone.'
      ]],
      ['What This Taught', [
        'A simulation should explain its assumptions through inspectable state. Showing the target and reconstructed vectors together makes a sign error visible, while a shared timeline keeps separate displays from telling conflicting stories.',
        'The other lesson is to distinguish a useful geometric model from a complete physical machine. Matching an ideal load vector is a meaningful result, but does not prove mechanical feasibility, comfort or safety. The draft keeps those boundaries explicit while leaving room for deeper dynamics modelling later.'
      ]]
    ]
  },
  {
    slug: 'ibkr', old: 'IBKR', title: 'Automated Investment Research and Execution',
    category: 'Research automation / Paper trading', stack: 'Python / FastAPI / PostgreSQL / Broker API / Docker',
    lead: 'Scheduled research, durable decisions and monitored paper-trade execution, with reporting that distinguishes an idea from a confirmed fill.',
    publicView: 'investment', publicLabel: 'Open the public research and execution view',
    features: 'Review recent research runs, target allocations and recorded paper executions from the production system. Research and execution remain separate, and the public view has no order controls.',
    flow: ['Schedule portfolio research', 'Validate and persist target allocations', 'Refresh broker state and execution checks', 'Reconcile orders and archive outcomes'],
    sections: [
      ['Research Without Execution', [
        'A dedicated research worker prepares portfolio research and records its outcome in PostgreSQL. The schedule follows the official exchange session, including shortened trading days, rather than assuming every weekday has the same hours. A decision to hold is a legitimate output; activity is not treated as evidence of a better decision.',
        'The research report and target allocations are persisted before the execution worker attempts to act. That separation allows research to continue through a broker-gateway outage. It also makes the history explainable: a completed research run does not imply an order was submitted, and a submitted order does not imply a fill.'
      ]],
      ['A Durable Decision Pipeline', [
        'The execution queue stores work independently of the process handling it. Restarting the worker therefore does not erase a decision or require guessing what was underway. Decisions can expire or be superseded, and changes to portfolio state can require fresh research instead of replaying an outdated allocation.',
        'Before execution, the worker refreshes holdings, available cash, prices and foreign-exchange information. Target weights must be translated into feasible trades under position, turnover and cash-reserve constraints. The queue is a request to re-evaluate those conditions, not permission to place the same order indefinitely.'
      ]],
      ['Orders and Reconciliation', [
        'The system submits monitored whole-share DAY limit orders in a paper account. It records order state and confirmed executions separately. If a connection fails around submission, the next step is reconciliation against broker records, not blindly submitting another order.',
        'That uncertainty is one of the central integration problems. A timeout only describes what the client observed; it does not prove the broker rejected the request. Explicit cancellation and reconciliation paths prevent a retry policy from becoming a duplicate-order policy. A kill switch can stop execution without stopping the research process.'
      ]],
      ['Reporting Has Different Rules', [
        'The reporting path can use independent market prices when the gateway is unavailable. Those prices may be delayed, and FX fallbacks have their own freshness and cross-rate handling. They support continuity of reporting; they do not silently replace the quotes required by execution checks.',
        'Performance history is archived on wall-clock hours independently of the trading loop, with retries and restart backfill. Existing observations are preserved rather than overwritten by a later valuation. This keeps historical reporting from becoming an accidental side effect of whether a trade happened that day.'
      ]],
      ['Failures That Shaped It', [
        'A broker callback changed the commission field it exposed, breaking an assumption in the order-handling path. Compatibility handling was needed for commissionAndFees as well as the older field. Another fault involved account-summary subscriptions: unsuccessful cancellation accumulated active subscriptions until repeated refreshes hit the broker\'s limit.',
        'A single successful connection could not reveal that second problem. Repeated read-only refresh checks were needed to demonstrate that the subscription lifecycle was actually being cleaned up. Session conflicts, missing permissions and uncertain submissions similarly required testing beyond the happy path.'
      ]],
      ['Public Scope and Limits', [
        'The public dashboard is a read-only projection of the running system, not a simulated dataset and not an authenticated operator session. It exposes recent run states, decision symbols and target weights, plus a limited execution history. Account identifiers, balances, private report text, raw broker responses and execution controls are not published.',
        'Production refers to the deployed application. Trading remains paper-only. These records demonstrate scheduling, persistence and integration engineering; they do not establish profitable returns, live-trading readiness or an investment recommendation.'
      ]],
      ['Engineering Lessons', [
        'Research, execution and reporting have different availability requirements. Keeping them separate lets one recover without pretending that another succeeded. Durable state provides the evidence needed to resume work safely.',
        'The external system remains the authority for what happened to an order. Local intent, network success and broker completion are three distinct states, and the application has to preserve that distinction in both its database and its user-facing reports.'
      ]]
    ]
  },
  {
    slug: 'mangasaver', old: 'MangaSaver', title: 'Media Library Reader',
    category: 'Desktop reader / Draft', stack: 'Python / PySide6 / CPU raster rendering / Local filesystem',
    lead: 'A local library reader built around responsive browsing, right-to-left spreads and switching between black-and-white and colour editions without losing your place.',
    flow: ['Index albums and chapter identities', 'Load visible covers and nearby pages', 'Compose the current reading spread', 'Persist progress and edition preferences'],
    captures: [
      ['library', 'The library and chapter browser', 'Screenshot pending', 'Album covers, chapter selection and saved reading progress.'],
      ['editions', 'Black-and-white to colour', 'GIF pending', 'Switch between two mapped editions at the same source-page position.'],
      ['reading', 'Reading, pairing and zoom', 'Screenshot or GIF pending', 'A right-to-left spread, an intentionally unpaired page and the page overview.']
    ],
    sections: [
      ['A Reader for Existing Libraries', [
        'This page focuses on viewing and navigating media already stored in local libraries. Albums and chapters form the browsing structure, while saved covers and progress make it possible to return to a long-running series without reconstructing the previous session.',
        'The reader is implemented with PySide6 and a custom CPU-painted viewport. It does not depend on a Qt Quick scene or an OpenGL, Direct3D or Vulkan rendering path. That choice concentrates the performance work on image decoding, scaling, caching and deciding which pages genuinely need to exist in memory.'
      ]],
      ['Library Identity and Progress', [
        'Filesystem names are useful labels but are not always stable identities. A chapter named 1 in one edition can correspond to 0001 in another. Numeric chapter identity mapping allows those folders to be associated without requiring identical spelling.',
        'A local viewer-state file stores reading progress, selected covers, edition associations and preferences such as pairing shifts and fullscreen behaviour. Progress tracks the underlying chapter and source-page index, not just the number of a rendered spread. That distinction matters whenever two editions or pairing settings produce different layouts from the same sequence of pages.',
        'Directory, chapter and cover-path caches reduce repeated filesystem work. These caches serve navigation, while the thumbnail cache serves image presentation; treating those as different jobs makes it easier to invalidate or rebuild the part that changed.'
      ]],
      ['Right-to-Left Reading', [
        'Two-page spreads follow a right-to-left arrangement. A pairing shift can leave the first page alone, and marking a page as fullscreen changes how subsequent pages are paired. These are reading decisions, not edits to the original image files.',
        'The renderer retains borders already present in the source rather than imposing an additional application gutter. Page zoom and an overview contact sheet support two different tasks: inspecting a page closely and finding a position in the chapter. Moving beyond the chapter end can continue into the next chapter instead of forcing a return to the library.',
        'Because progress is tied to the source sequence, changing how pages are paired need not be confused with changing the reader\'s place. The same principle supports restoring the precise chapter scroll position after another interaction.'
      ]],
      ['Two Editions, One Place', [
        'The colour switch selects an associated alternate album. It is not an image-colourisation model: black-and-white and colour are separate source libraries supplied to the reader. Chapter mapping connects the editions, while per-mode cover and pairing preferences allow each to retain the layout that suits its files.',
        'Switching preserves the source location where the mapping permits it. Where an alternate chapter is unavailable, the reader falls back to the original material rather than showing an invented match. This turns a potentially disruptive library change into a reading operation with explicit limits.',
        'Alignment controls handle differences between editions through translation and scale. Fine adjustment modifiers and small scale increments support more precise matching than a coarse drag alone. Those controls are useful because corresponding pages can have different crop, margin or image dimensions.'
      ]],
      ['Doing Less Work per Frame', [
        'The library viewport is virtualised: visible covers and the region near them receive work before content that is far off screen. Thumbnail decoding and scaling run asynchronously, and a disk cache keeps useful raster results between sessions. The goal is not to create a widget or decoded image for every page in an entire collection.',
        'During reading, neighbouring spreads are prefetched. A double-buffered handover keeps the current image visible until the replacement is ready, addressing the black flash that can otherwise accompany a page change. Prioritised work helps an alignment or reading interaction avoid waiting behind unrelated thumbnail generation.',
        'Alternate-edition covers are prewarmed after a short idle delay, in small batches around the visible area. This prepares an edition switch without eagerly decoding the whole other library. The optimisations are workload choices, not an unverified claim that every machine or collection loads a fixed number of times faster.'
      ]],
      ['A Cold-Start Failure', [
        'A particularly important failure involved two thumbnail workers entering image construction during a cold start. The resulting native deadlock did not behave like a normal Python exception. Initialising the relevant image path on the GUI thread before concurrent work addressed that startup ordering problem.',
        'The first reproduction approach was misleading: it warmed the image bindings and used a different window size, changing the thumbnail workload. A cold-cache run at the real application dimensions, using the actual context-menu route, reproduced the problem. An external native stack capture could then observe the blocked process without depending on the frozen UI.'
      ]],
      ['Lessons and Boundaries', [
        'Responsiveness comes from controlling when work happens as much as from making each operation faster. Virtualisation, nearby prefetching, cache reuse and small idle batches address different parts of the experience and need to be evaluated together.',
        'The debugging lesson was equally concrete: a test that changes startup state can remove the failure it is meant to observe. This draft focuses on library browsing, edition switching and reading behaviour. Media acquisition is outside the scope of this presentation.'
      ]]
    ]
  },
  {
    slug: 'fh6grindscript', old: 'FH6GrindScript', title: 'Screen State-Based Automation Execution',
    category: 'Visual automation / Desktop draft', stack: 'Python / Blockly / pywebview / Screen capture / Native input',
    lead: 'A visual automation editor that evaluates what is actually on screen before running an inspectable sequence of inputs.',
    flow: ['Capture screen or sampled pixels', 'Evaluate a saved trigger condition', 'Acquire the main execution slot and recheck', 'Run actions with live block feedback'],
    captures: [
      ['editor', 'Building an automation', 'Screenshot pending', 'A Blockly sequence containing a visual condition, input action and wait.'],
      ['capture', 'Defining a screen state', 'Screenshot pending', 'Reference capture, sampled pixels and the match threshold.'],
      ['execution', 'Following a running sequence', 'GIF pending', 'The active block highlight moving through a loop and conditional branch.']
    ],
    sections: [
      ['From Timed Macro to State Machine', [
        'A fixed sequence of key presses assumes the application is ready at the same time on every run. This project replaces that assumption with conditions derived from screen content. A sequence can wait for a match, branch when a state is present or keep an input held until a condition becomes true.',
        'The visual editor uses Blockly to represent bindings, triggers and actions. A Python runtime performs native screen capture, hotkey handling and input execution, while pywebview connects that runtime to the editor. A browser fallback supports the editor surface, but the native desktop bridge remains responsible for operating the computer.'
      ]],
      ['Describing a Visual State', [
        'Pixel sets record monitor-relative coordinates and expected RGB colours with a tolerance. A full-screen reference can instead provide a template comparison. Both approaches turn visual evidence into a match score, allowing the threshold to be adjusted to the stability of the target interface.',
        'A match fraction is literal: four matching samples out of five give 0.8. It is not a probability that the program understands the scene. Choosing stable pixels and appropriate tolerance matters more than presenting that number as intelligence. Animation, display scaling, window position and changing colours can all affect a match.',
        'The capture preview updates at a modest rate, while the comparison target follows the condition being evaluated at runtime. This keeps inspection connected to the active wait or trigger rather than leaving a stale reference on screen.'
      ]],
      ['A Common Condition Language', [
        'Conditions can combine screen or pixel matches with AND, OR and NOT. They can also inspect target state, whether a binding is active or enabled, numeric comparisons and match-score thresholds. Sharing this condition representation across triggers, branches and loops reduces the number of subtly different ways to describe the same rule.',
        'Older trigger fields are migrated into the unified trigger-condition representation. Saving a workspace and loading it again must retain that meaning. JSON round-trip behaviour is therefore part of the editor\'s correctness, not just a convenience for storing blocks.'
      ]],
      ['Actions and Execution Ownership', [
        'The runtime supports presses, waits, timed holds, holds until a condition, loops until a condition, conditional branches and background watchers. These constructs let an automation express both a planned sequence and the checks that decide when it may continue.',
        'Each binding may watch for its trigger, but only one main sequence owns the action-execution slot at a time. A trigger is checked again after that slot is acquired. Without the second check, a binding could queue while a screen matched and execute later after the application had moved somewhere else.',
        'Background watchers belong to the active binding and react to false-to-true transitions. Their work is joined before the main slot is released. That lifecycle prevents a completed sequence from leaving an old watcher competing with the next binding for control.'
      ]],
      ['Showing What Is Running', [
        'A visual program needs runtime feedback at the same level as its editing model. Block identifiers travel through execution so the editor can highlight the action or condition currently being processed. Waits remain highlighted for their actual lifetime, while short input actions are still visible long enough to inspect.',
        'Nested execution exposed two different problems. A descendant CSS selector made more than the intended block appear active, and a loop path needed to preserve the child step wrapper so its identifiers reached the feedback channel. Correcting both made the highlight describe real execution rather than merely indicating that some outer block was running.',
        'The editor polls runtime state frequently enough to follow a sequence without treating the UI as a frame-by-frame video stream. The stop hotkey provides an explicit interruption route; visual conditions do not remove the need to supervise automation.'
      ]],
      ['What Needed Solving', [
        'The hardest design issue was coordinating concurrent observation with serial input. Watching several bindings is useful, but allowing each to send keys independently would make the result depend on timing. The shared execution slot and post-acquisition trigger check establish an understandable ordering.',
        'Another issue was keeping the editor, saved document and runtime aligned as the condition model evolved. A block that displays correctly but reloads with a different trigger is a behavioural bug. Migration and round-trip checks protect that contract across all three representations.'
      ]],
      ['Lessons and Limitations', [
        'State-based automation is more adaptable than a sequence of sleeps, but it still depends on the quality of its observations. This implementation does not infer game state from telemetry or OCR. A visual match remains vulnerable to display and application changes, so thresholds and sample locations must be treated as part of the program.',
        'The broader lesson is that an automation tool has two users: the person defining a sequence and the person trying to understand why it ran. Explicit ownership, visible conditions, persistent block identity and inspectable feedback serve both.'
      ]]
    ]
  },
  {
    slug: 'news-signal-dashboard', old: 'NewsSignalDashboard', title: 'Media Influence on Market Prices',
    category: 'Data collection / Market observations', stack: 'JavaScript / PostgreSQL / Background workers / Cloudflare / Snapshot publishing',
    lead: 'A growing news corpus connected to later market observations, with explicit timing and sample-size limits on what those relationships can mean.',
    publicView: 'market', publicLabel: 'Open the public news and market view',
    features: 'Browse production article records, filter by source or ticker and inspect stored price changes over the available horizons. Missing observations remain missing; the page does not manufacture predictions.',
    flow: ['Collect articles with source provenance', 'Classify relevance and identify explicit tickers', 'Record features and later market observations', 'Publish bounded, timestamped research views'],
    sections: [
      ['Collection Before Prediction', [
        'The current collection profile prioritises investment relevance and directly identifiable tickers. It does not ask the collection worker to browse for supporting evidence, write a summary, assign sentiment or predict a market move. This narrower contract makes the incoming corpus easier to inspect and separates collection from later analysis.',
        'Historical bullish and bearish predictions are retained as historical data, not relabelled as outputs of the current profile. New records can be unscored. Keeping those generations distinct avoids suggesting that all entries were produced by one unchanged methodology.'
      ]],
      ['Provenance and Measurable Features', [
        'Article records preserve a source link and discovery and publication timing. Direction-neutral analysis extracts properties such as document structure, words and phrases, ticker mentions, source and timing. Those features can later be compared with observed market behaviour without requiring a sentiment label as the starting point.',
        'Incremental extraction and bounded database work keep the analysis from repeatedly rebuilding everything. The corpus, feature observations and market records have separate lifecycles: discovering an article does not mean all of its text or future price horizons are already available.'
      ]],
      ['Connecting News to Prices', [
        'A baseline price anchors subsequent observations for a ticker. Each horizon records the time and price available for that observation and the percentage change relative to the baseline. A horizon that has not matured, or for which data is absent, must not be treated as a zero-percent move.',
        'The public view presents recent stored observations and their source articles. It is a window into the production corpus, not a complete export of every article or every analytical table. The capture time tells visitors when that window was refreshed; each article and observation retains its own timestamp.',
        'Despite the project title, temporal association does not prove that an article caused a price change. Market-wide events, overlapping coverage and other factors remain possible explanations. The project supports exploration of relationships, not a causal claim.'
      ]],
      ['Reproducible Daily Snapshots', [
        'The deeper relationship analysis uses a fixed daily cutoff at Brisbane midnight. Articles discovered after that cutoff, features generated after it and market observations arriving after it are excluded from that snapshot. Using an exact cutoff prevents a later run from silently including information that was unavailable at the intended point in time.',
        'Outputs are built into compressed shards with a manifest describing sizes and hashes. Publication changes the active pointer only after staging is complete. If generation fails, the previous complete snapshot remains available rather than exposing a mixture of old and new files.'
      ]],
      ['The Denominator Problem', [
        'One correction concerned a confidence-style score based on samples divided by samples plus 100. The relevant sample count is the number of observations available for the particular horizon, not the size of the original article cohort. A large source cohort cannot supply evidence for a horizon with only one recorded outcome.',
        'Under that heuristic, one observation gives approximately 0.99 percent, while 100 observations give 50 percent. These values are a sample-coverage heuristic, not statistical significance or a guarantee that observations are independent. Filtering must occur before sorting and limiting so the visible result set actually obeys the requested criteria.'
      ]],
      ['What the Architecture Solves', [
        'The authenticated API, background collectors, market tracking and snapshot generation are separated so a public read does not trigger expensive analytical work. The portfolio copy follows the same principle: it serves small, precomputed read-only projections rather than forwarding arbitrary requests to operator endpoints.',
        'Timestamps and missing values are first-class data. They make delayed observations, incomplete collection and stale publication visible instead of allowing a polished dashboard to imply a completeness the underlying corpus has not reached.'
      ]],
      ['Lessons and Scope', [
        'Data-pipeline correctness often depends on apparently small choices: the denominator of a score, whether a filter happens before a limit, and which timestamp defines inclusion. Those choices can change the interpretation of an entire result table.',
        'The public page links back to original sources and publishes bounded metadata and price observations, not full article bodies or private operational logs. It is an engineering research view, not financial advice or evidence of a profitable strategy.'
      ]]
    ]
  },
  {
    slug: 'instagram-research-system', old: 'Design Instagram Research System', title: 'Social Media Research to Database pipeline',
    category: 'Research pipeline / Searchable library', stack: 'Python / JavaScript / PostgreSQL / Media processing / Cloudflare',
    lead: 'Turning shared social posts into an organised research library while retaining the evidence and source links behind each finding.',
    publicView: 'research', publicLabel: 'Open the public research library',
    features: 'Search production resource records and read their derived summaries alongside original source links. The public library excludes private messages, sender identities, account settings and processing controls.',
    flow: ['Receive and deduplicate a shared post', 'Capture available text, audio and visual evidence', 'Research and assemble linked resource records', 'Publish and index the library for retrieval'],
    sections: [
      ['Beyond Saving a Link', [
        'A saved Reel or carousel can contain a useful resource without making it easy to find again. This pipeline extracts the available evidence, researches the referenced material and stores linked findings in a library. The source post remains part of the record so the result can be checked rather than becoming an unattributed summary.',
        'The private reader combines a searchable file tree, retained media and persistent reading state. Search can work across creators, posts and extracted resources. The public copy exposes a narrower resource catalogue drawn from the same production database, without exposing the private intake or operator session.'
      ]],
      ['Intake and Evidence', [
        'Incoming shares are normalised and deduplicated before expensive work begins. Reels and carousels require different media handling, and the evidence available for one post is not assumed to exist for another. Descriptions, transcript or audio information, selected frames and captured comments can contribute when present.',
        'The pipeline keeps source evidence distinct from the derived research. A resource name, canonical link, summary and explanation of usefulness are separate from the original post and its media. This makes it possible to follow a finding back to its origin and avoids treating every generated sentence as a direct statement by the creator.'
      ]],
      ['Checkpointed Processing', [
        'Long-running media and research jobs are divided into stages with persisted checkpoints. Dispatchers claim work with explicit lease identity, and the control path verifies returned checkpoints before allowing publication. Compute output is not trusted merely because a worker produced it.',
        'This matters during crashes and restarts. A process may disappear after doing useful work but before reporting completion. Recoverable stage state and idempotent publication reduce duplicate work and prevent retries from creating duplicate library entries. Claims that were acquired but never started also need a recovery path.'
      ]],
      ['From Research to Library', [
        'The processing stages assemble resource records and linked Markdown or HTML artifacts. Retrieval documents bring searchable evidence together while retaining the job and source association. Resource identity and canonical links help connect repeated references to the same underlying tool or idea.',
        'When retrieval is ambiguous, the system can return candidates rather than guessing which source the user meant. That is an important distinction for a personal research archive: a confident answer linked to the wrong post is less useful than a short set of inspectable possibilities.',
        'The public library supports searching and opening the current published resource summaries. It links to external resources and original posts where valid public URLs exist; it does not redistribute private direct-message payloads or the entire retained media archive.'
      ]],
      ['Changing the Storage Architecture', [
        'The system evolved from edge-oriented storage and mirrors toward a self-hosted PostgreSQL and disk-backed primary pipeline. Edge intake and fallback components still serve distinct roles. Moving the primary workload did not automatically remove the cost or behaviour of older mirror paths.',
        'A stale watermark and thumbnail-related triggers continued generating excessive edge reads after the migration. The correction was to make progress explicit through an indexed committed cursor and prevent read-only activity from waking unnecessary work. The lesson was to audit the paths that remained, not only the new primary path.'
      ]],
      ['Failures Behind Green Services', [
        'Leaked SQLite handles eventually exhausted the open-file limit and stalled jobs even though the service processes were still running. Closing handles addressed the resource leak; observing queue progress and handover addressed the misleading health signal. A live process is not proof that a pipeline is completing work.',
        'Media handling had a different bottleneck. Sequential frame processing could run into FFmpeg timeouts, so frame sampling used targeted seeks instead of requiring every intervening frame to be traversed. This is a workload-specific optimisation: capture the evidence needed for the stage rather than processing the full source indiscriminately.'
      ]],
      ['Lessons and Public Boundaries', [
        'Reliability depends on identity, ownership and progress being visible in durable state. A stage needs to know which claim owns it, what evidence is complete and whether publication has already occurred. Those distinctions make recovery deliberate instead of speculative.',
        'The public copy is live production data, refreshed through a dedicated read-only projection. It publishes resource findings and source references while leaving sender identifiers, private instructions, messages, runtime secrets and controls behind authentication. Research summaries remain derived material and should be checked against their linked sources.'
      ]]
    ]
  }
];

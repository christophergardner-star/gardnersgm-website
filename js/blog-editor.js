/* ===========================================
   BLOG EDITOR — AI Content Agent
   Gardners Ground Maintenance
   =========================================== */

(function () {
    'use strict';

    const WEBHOOK = 'https://script.google.com/macros/s/AKfycby6A7vdArDo2zpW5i38TxGPl1bfQAYeiUaZbxA2-aeBUdxm-nsc_4ou_rZsMUY099eOCw/exec';
    const TELEGRAM_TOKEN = '8261874993:AAHW6752Ofhsrw6qzOSSZWnfmzbBj7G8Z-g';
    const TELEGRAM_CHAT = '6200151295';

    let allPosts = [];
    let editingId = null;

    // ─── DOM ───
    const postList = document.getElementById('editorPostList');
    const statusFilter = document.getElementById('editorStatusFilter');

    // ─── Init ───
    loadPosts();
    loadSocialUrls();

    // ─── Event Listeners ───
    document.getElementById('newPostBtn').addEventListener('click', newPost);
    document.getElementById('saveDraftBtn').addEventListener('click', () => savePost('draft'));
    document.getElementById('publishBtn').addEventListener('click', () => savePost('published'));
    document.getElementById('deletePostBtn').addEventListener('click', deletePost);
    document.getElementById('aiGenerateBtn').addEventListener('click', generateFromTemplate);
    document.getElementById('aiCustomBtn').addEventListener('click', generateFromPrompt);
    document.getElementById('regenerateSocialBtn').addEventListener('click', generateSocials);
    document.getElementById('saveSocialUrlsBtn').addEventListener('click', saveSocialUrls);
    statusFilter.addEventListener('change', renderPostList);

    // Image fetch
    document.getElementById('fetchImageBtn').addEventListener('click', fetchImage);
    document.getElementById('editImageUrl').addEventListener('input', function() {
        const url = this.value.trim();
        if (url) showImagePreview(url); else hideImagePreview();
    });

    // Social tabs
    document.querySelectorAll('.social-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelector('.social-tab.active').classList.remove('active');
            tab.classList.add('active');
            document.querySelectorAll('.social-preview').forEach(p => p.style.display = 'none');
            document.getElementById('socialPreview' + capitalise(tab.dataset.platform)).style.display = 'block';
        });
    });

    // Copy buttons
    document.querySelectorAll('.social-copy-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const ta = document.getElementById(btn.dataset.target);
            navigator.clipboard.writeText(ta.value).then(() => {
                btn.innerHTML = '<i class="fas fa-check"></i> Copied!';
                setTimeout(() => { btn.innerHTML = '<i class="fas fa-copy"></i> Copy'; }, 2000);
            });
        });
    });

    // Social text char counters
    ['fbText', 'igText', 'xText'].forEach(id => {
        document.getElementById(id).addEventListener('input', updateSocialCounts);
    });

    // ═══════════════════════════════════════
    //  AI CONTENT AGENT — Template Library
    // ═══════════════════════════════════════

    const TEMPLATES = {
        // ── Seasonal ──
        'spring-prep': {
            category: 'seasonal',
            title: '🌱 Spring Garden Prep: Your Essential Cornwall Checklist',
            tags: 'spring, garden prep, cornwall, lawn care',
            excerpt: 'Spring is the perfect time to get your garden back in shape after the winter months. Here\'s our expert checklist for Cornwall gardens.',
            content: `## Getting Your Garden Spring-Ready

Spring has arrived in Cornwall, and it's time to breathe new life into your outdoor spaces! After months of wind and rain, your garden is ready for some attention.

## Lawn Care

**Start with a good rake** — remove any thatch, moss, and dead grass that's built up over winter. This opens up the soil and lets air and nutrients reach the roots.

- Rake thoroughly to remove debris and thatch
- Apply a spring lawn feed (high nitrogen for green growth)
- Overseed any bare patches with quality grass seed
- Begin mowing when the grass reaches 3-4 inches (set the mower high!)
- Consider scarifying if moss has taken hold

## Borders and Beds

**Clear and prepare your borders** for the growing season ahead:

- Remove dead plant material and old mulch
- Fork over the soil to loosen compaction
- Add a layer of well-rotted compost or manure
- Divide and replant overcrowded perennials
- Start planting summer-flowering bulbs

## Hedges and Shrubs

Early spring is ideal for getting hedges back into shape before nesting season:

- Trim overgrown hedges before birds start nesting (check first!)
- Shape evergreen hedges lightly
- Prune winter-damaged branches from shrubs
- Apply mulch around the base of hedges

## Hard Landscaping

Don't forget your paths, patios, and driveways:

- **Power wash** hard surfaces to remove winter grime and algae
- Check for damaged or loose slabs
- Clear gutters and drains of leaf debris
- Repair any fencing damaged by winter storms

## Our Spring Services

At Gardners Ground Maintenance, we offer all these services and more across Cornwall. Whether you need a one-off spring tidy or regular maintenance, we've got you covered.

**Book your spring garden makeover today** and let us get your outdoor space ready for the warmer months ahead! 🌿`,
        },

        'summer-care': {
            category: 'seasonal',
            title: '☀️ Summer Lawn Care: Keeping Your Grass Green in the Heat',
            tags: 'summer, lawn care, watering, mowing',
            excerpt: 'Cornwall summers can be hot and dry. Here\'s how to keep your lawn looking lush and green all season long.',
            content: `## Keeping Your Lawn Beautiful Through Summer

Cornwall summers bring sunshine, BBQs, and long evenings — but they can also stress your lawn. Here's how to keep it looking its best.

## Mowing in Summer

**The golden rule: never cut more than one-third** of the grass blade at a time.

- Raise your mower height in hot weather (3-4 inches ideal)
- Mow in the evening when it's cooler
- Leave clippings on the lawn — they return moisture and nutrients
- Sharp blades are essential — torn grass goes brown faster
- Mow every 5-7 days in peak growing conditions

## Watering Wisely

Water is precious — use it effectively:

- Water deeply but infrequently (once or twice a week)
- Early morning is best (6-8am) — less evaporation
- Aim for about 1 inch of water per session
- Don't panic if your lawn goes brown — it's dormant, not dead
- Focus watering on newly seeded areas and borders

## Feeding

**A summer feed works wonders** for keeping green colour:

- Use a summer-specific lawn feed (balanced N-P-K)
- Apply after rain or watering for best absorption
- Avoid feeding during very hot, dry spells
- Liquid seaweed feeds can help with drought resistance

## Dealing with Common Issues

- *Brown patches:* Usually drought stress — increase watering
- *Weeds:* Spot-treat with selective weedkiller
- *Bare areas:* Wait until autumn to reseed (too hot now)
- *Ant hills:* Brush them flat before mowing

## Professional Help

Don't have time to keep on top of your lawn this summer? Our weekly and fortnightly lawn care packages keep your garden looking perfect without you lifting a finger.

**Book your summer lawn care package today!** 🌞`,
        },

        'autumn-tidy': {
            category: 'seasonal',
            title: '🍂 Autumn Garden Tidy: Preparing for Winter in Cornwall',
            tags: 'autumn, garden tidy, winter prep, leaves',
            excerpt: 'Autumn is the most important time for garden maintenance. Get ahead of winter with our comprehensive Cornwall garden guide.',
            content: `## Autumn: The Most Important Season for Your Garden

Autumn might signal the end of summer, but it's actually the busiest time for garden maintenance. What you do now determines how your garden looks next spring.

## Leaf Management

**Don't let fallen leaves smother your lawn!**

- Rake or blow leaves regularly — at least weekly
- Remove leaves from flower beds, paths, and drains
- Compost healthy leaves for amazing leaf mould
- Check gutters and downpipes for blockages
- Clear leaves from around the base of plants to prevent rot

## Lawn Preparation

Autumn is THE best time to repair and improve your lawn:

- Scarify to remove thatch and moss buildup
- Aerate compacted areas with a garden fork or machine
- Overseed thin or bare patches — ideal germination conditions
- Apply autumn lawn feed (high potassium for root strength)
- Lower mower height gradually as growth slows

## Planting and Pruning

- Plant spring-flowering bulbs (daffodils, tulips, crocuses)
- Move or divide established perennials
- Prune deciduous hedges once leaves have dropped
- Cut back dead perennial stems
- Plant shrubs and trees — the soil is still warm

## Protecting Your Garden

Get ahead of the Cornish winter weather:

- Wrap tender plants in fleece
- Move pots to sheltered spots
- Lag outdoor taps
- Secure loose fencing and trellises
- Apply a thick mulch to protect plant roots

## Professional Autumn Services

Our garden clearance and autumn tidy service is our most popular booking this time of year. We'll leave your garden fully prepped for winter.

**Book your autumn garden tidy today!** 🍁`,
        },

        'winter-protect': {
            category: 'seasonal',
            title: '❄️ Winter Garden Protection: Cornwall Cold Weather Guide',
            tags: 'winter, protection, frost, cornwall',
            excerpt: 'Cornwall winters are milder than most, but your garden still needs protection. Here\'s our guide to winter garden care.',
            content: `## Winter Garden Care in Cornwall

Cornwall's mild maritime climate means we don't get the extremes that most of the UK does, but our gardens still need attention through the colder months.

## Protecting Plants

- Wrap borderline-hardy plants in horticultural fleece
- Move potted plants to sheltered spots near the house
- Apply thick mulch (4-6 inches) over root zones
- Avoid walking on frozen lawns — it damages the grass
- Check ties and supports on climbing plants

## Winter Lawn Care

Your lawn isn't growing much, but it still needs care:

- Keep off the lawn when it's frosty or waterlogged
- Remove fallen leaves — they'll smother the grass
- Clean and service your mower ready for spring
- Apply a winter lawn treatment if moss is a problem
- Avoid any mowing — wait until growth resumes

## Hard Landscaping Maintenance

Winter is perfect for tackling the hard stuff:

- **Power wash** patios, paths, and driveways (removes slippery algae!)
- Repair broken fences before the next storm
- Clear drains and gutters — essential for Cornwall's rainfall
- Check for trip hazards — loose or sunken slabs
- Treat wooden structures with preservative

## Planning Ahead

Use the quieter months to plan your dream garden:

- Sketch out planting plans for spring
- Order seeds and bulbs from catalogues
- Research new plants suited to your soil
- Get quotes for bigger projects (landscaping, clearance)
- **Book early** — spring slots fill up fast!

## Our Winter Services

We offer power washing, garden clearance, and winter maintenance throughout the colder months. Don't wait until spring — get ahead of the rush!

**Contact us for a free winter maintenance quote** ❄️`,
        },

        // ── Tips & Advice ──
        'lawn-tips': {
            category: 'tips',
            title: '🌿 Lawn Care 101: The Complete Guide to a Perfect Lawn',
            tags: 'lawn care, mowing, feeding, tips',
            excerpt: 'Everything you need to know about maintaining a healthy, green lawn in Cornwall — from mowing heights to feeding schedules.',
            content: `## Your Complete Guide to a Beautiful Lawn

A healthy lawn is the centrepiece of any garden. Whether you've got a small front garden or acres of grounds, the principles are the same.

## Mowing — The Basics

**Mowing is the single most important thing** you can do for your lawn:

- Never remove more than one-third of the blade
- Change mowing direction each time
- Keep blades sharp — dull blades tear and brown the grass
- Spring/Summer: mow weekly, height 2.5-3.5 inches
- Autumn: reduce frequency, raise height slightly
- Winter: leave it alone unless growth is exceptional

## Feeding Your Lawn

A well-fed lawn fights weeds and disease naturally:

- Spring (March-April): High nitrogen feed for green growth
- Summer (June-July): Balanced feed with potassium
- Autumn (September-October): Low nitrogen, high potassium for roots
- Avoid feeding in drought or frozen conditions

## Watering

Less is more when it comes to watering:

- Water infrequently but deeply encourages deep roots
- Morning watering reduces disease risk
- Brown lawns in summer are usually dormant, not dead
- New seed and turf need regular watering until established

## Common Problems

- *Moss:* Usually caused by shade, poor drainage, or low nutrients. Scarify and address the cause
- *Bare patches:* Overseed in autumn with fresh grass seed
- *Weeds:* A healthy, thick lawn naturally resists weeds
- *Waterlogging:* Aerate in autumn to improve drainage

## When to Call the Professionals

If your lawn needs more help than a basic mow, we're here. From scarifying to full lawn renovation, we'll get your grass looking perfect.

**Book a lawn care service today!** 🌿`,
        },

        'hedge-guide': {
            category: 'tips',
            title: '🌳 The Complete Guide to Hedge Trimming in Cornwall',
            tags: 'hedges, trimming, pruning, guide',
            excerpt: 'When to trim, how to shape, and which tools to use — your definitive guide to perfect hedges in Cornwall.',
            content: `## Everything You Need to Know About Hedge Trimming

Well-maintained hedges add structure, privacy, and wildlife value to any garden. Here's how to keep yours looking sharp.

## When to Trim

**Timing is everything** with hedge maintenance:

- *Formal hedges (box, yew, privet):* Trim 2-3 times per year (May, July, September)
- *Informal hedges (hawthorn, beech):* Once in late summer
- *Conifer hedges:* Trim in spring and late summer — never cut into old wood
- *Flowering hedges:* After flowering has finished
- **Important:** Check for nesting birds before cutting (March-August). It's illegal to disturb active nests!

## The Right Tools

- *Hand shears:* Best for small hedges and precision work
- *Electric/battery trimmer:* Ideal for medium hedges
- *Petrol hedge trimmer:* For large hedges and tough growth
- *Loppers:* For thicker branches in neglected hedges
- Always wear safety goggles and gloves

## Shaping Tips

- Trim hedges wider at the base than the top (A-shape)
- This allows sunlight to reach the lower branches
- Use a taut string line for straight tops
- Step back regularly to check the shape
- Clear up clippings — they can smother the lawn

## Renovation

Overgrown hedges can usually be brought back:

- Cut one side hard back in winter, the other side next year
- Feed heavily after hard pruning
- Most deciduous hedges recover well from hard pruning
- Some conifers (especially Leylandii) won't regrow from old wood

## Professional Hedge Services

We trim hedges of all types and sizes across Cornwall. From small box hedges to 20-foot Leylandii, we've got the equipment and experience.

**Book your hedge trimming today!** 🌳`,
        },

        'weed-control': {
            category: 'tips',
            title: '🌾 Conquer Your Weeds: Natural & Effective Weed Control',
            tags: 'weeds, weed control, organic, garden tips',
            excerpt: 'Tired of weeds taking over? Here are proven methods to keep them under control — naturally and effectively.',
            content: `## Taking Control of Garden Weeds

Weeds are every gardener's nightmare, but with the right approach, you can keep them under control without endless hours of pulling.

## Prevention is Better Than Cure

**Stop weeds before they start:**

- Mulch beds with 3-4 inches of bark, compost, or gravel
- Plant ground cover plants to shade out weeds
- Don't leave bare soil exposed
- Keep your lawn thick and healthy — it naturally fights weeds
- Use landscape fabric under gravel paths

## Natural Weed Control

Effective methods that don't harm the environment:

- *Hand weeding:* Still the most effective! Get the whole root
- *Hoeing:* Slice weeds off at the surface on sunny days
- *Boiling water:* Pour on patio weeds — kills them instantly
- *White vinegar:* Spray on weeds in cracks and crevices
- *Mulching:* The best long-term weed suppressant

## Common Weeds in Cornwall

- *Dandelions:* Deep taproot — use a daisy grubber to remove
- *Clover:* Sign of low nitrogen — apply lawn feed
- *Moss:* Improve drainage, increase light, scarify
- *Ground elder:* Very persistent — requires digging out all roots
- *Bindweed:* Train up canes and apply glyphosate to leaves

## In the Lawn

A healthy, well-fed lawn is your best weed defence:

- Regular mowing prevents weeds setting seed
- Feed regularly to thicken the grass
- Overseed thin areas in autumn
- Spot-treat persistent weeds with selective weedkiller

## Garden Clearance Service

Got a garden that's been taken over by weeds? Our garden clearance service will transform it back to a manageable space.

**Book a garden clearance today!** 🌿`,
        },

        'tools-guide': {
            category: 'tips',
            title: '🔧 Essential Garden Tools: What Every Homeowner Needs',
            tags: 'tools, equipment, garden essentials, beginners',
            excerpt: 'Not sure what tools you need? Here\'s our professional guide to the essential garden toolkit for Cornwall homeowners.',
            content: `## The Tools Every Garden Needs

You don't need a shed full of gadgets to maintain a beautiful garden. Here are the essentials that every Cornwall homeowner should have.

## The Must-Haves

These are the tools you'll use week in, week out:

- **Lawn mower** — Rotary for most lawns, cylinder for a striped finish
- **Spade** — For digging, edging, and planting
- **Fork** — Loosening soil, turning compost, aerating
- **Secateurs** — Pruning, deadheading, light cutting
- **Rake** — Leaf clearing and lawn dethatching
- **Hoe** — Weed control in borders

## Nice to Have

Tools that make life easier:

- *Hedge trimmer* — Electric or battery for regular hedge maintenance
- *Wheelbarrow* — Essential for larger gardens
- *Loppers* — For thicker branches up to 2 inches
- *Leaf blower* — Saves hours in autumn
- *Watering can or hose* — With a spray attachment

## Tool Maintenance

Look after your tools and they'll last years:

- Clean after every use — remove soil and plant material
- Oil metal parts to prevent rust
- Sharpen blades regularly (mower, shears, secateurs)
- Store in a dry shed or garage
- Wooden handles — sand and oil annually

## What the Professionals Use

At Gardners Ground Maintenance, our kit includes:

- Professional cylinder and rotary mowers
- Commercial-grade hedge trimmers
- Scarifiers and aerators
- Industrial pressure washers
- Strimmer and brushcutters

**Don't fancy doing it yourself? Let us handle it — book a service today!** 🔧`,
        },

        'watering': {
            category: 'tips',
            title: '💧 Watering Your Garden: The Complete Guide',
            tags: 'watering, drought, summer tips, irrigation',
            excerpt: 'Watering seems simple, but getting it right makes all the difference. Learn the best practices for Cornwall gardens.',
            content: `## The Art of Watering Your Garden

Watering might seem straightforward, but doing it wrong can actually harm your plants. Here's how to water like a pro.

## The Golden Rules

- **Water in the morning** (6-8am) — reduces evaporation and disease
- Water the soil, not the leaves
- Deep, infrequent watering beats little and often
- Newly planted items need regular watering until established
- Group plants with similar water needs together

## Lawns

- Established lawns rarely need watering — they recover from drought
- New turf: water daily for the first 2 weeks, then reduce
- New seed: keep moist (not waterlogged) until established
- If you do water, apply about 1 inch per session

## Borders and Beds

- Mulch conserves moisture — apply 3-4 inches
- Focus water at the base of plants, not over the top
- Pots dry out faster than ground-planted beds
- Clay pots lose moisture faster than plastic
- Self-watering pots are great for holidays

## Water-Saving Tips

Cornwall gets plenty of rain, but dry spells happen:

- Install a water butt to collect rainwater
- Choose drought-tolerant plants for sunny spots
- Mulch, mulch, mulch!
- Water in the morning, never midday
- Use drip irrigation for borders — saves up to 70% water

**Need help setting up your garden for low-maintenance watering? Give us a call!** 💧`,
        },

        'composting': {
            category: 'tips',
            title: '♻️ Composting for Beginners: Turn Waste into Garden Gold',
            tags: 'composting, organic, recycling, soil',
            excerpt: 'Start composting and create free, nutrient-rich soil for your garden. It\'s easier than you think!',
            content: `## Composting: The Best Thing You Can Do For Your Garden

Composting turns kitchen and garden waste into rich, dark, crumbly gold that your plants will love. And it's incredibly simple.

## Getting Started

You need just three things:

- A compost bin or heap (any size works)
- A mix of "green" and "brown" materials
- A bit of patience (3-12 months)

## What to Compost

**Green materials** (nitrogen-rich, wet):
- Grass clippings
- Vegetable peelings
- Tea bags and coffee grounds
- Fresh weeds (without seeds)
- Fruit scraps

**Brown materials** (carbon-rich, dry):
- Cardboard and newspaper (shredded)
- Dry leaves
- Wood chippings
- Straw
- Egg boxes

## What NOT to Compost

- Meat, fish, or dairy (attracts rats)
- Cooked food
- Diseased plant material
- Perennial weed roots
- Cat or dog waste
- Glossy paper

## Tips for Success

- Aim for roughly 50/50 green and brown
- Turn the heap every few weeks for faster composting
- Keep it moist but not waterlogged
- Chop or shred large items for faster breakdown
- A hot bin in a sunny spot composts faster

## Using Your Compost

- Dig into beds as a soil improver
- Use as mulch around plants
- Mix into potting compost
- Spread on lawns as a top dressing
- Use in planting holes for new shrubs and trees

**We can supply and spread compost as part of our garden services. Book today!** ♻️`,
        },

        // ── Project Showcases ──
        'project-before-after': {
            category: 'projects',
            title: '📸 Before & After: [Location] Garden Transformation',
            tags: 'before and after, transformation, project',
            excerpt: 'See the incredible transformation of this [location] garden — from overgrown and neglected to beautifully maintained.',
            content: `## Garden Transformation: [Location]

**The Challenge:** This [location] garden had been neglected for [time period] and the owners were overwhelmed. The lawn was full of weeds, hedges overgrown, and the patio barely visible under moss and algae.

## What We Did

Our team spent [number] days transforming this garden:

**Day 1: Clearance**
- Cleared all overgrown vegetation and debris
- Cut back hedges to a manageable height
- Removed dead plants and weeds from borders
- Strimmed all edges and hard-to-reach areas

**Day 2: Lawn & Patio**
- Scarified the entire lawn to remove moss and thatch
- Applied lawn treatment and overseeded bare patches
- Power washed the patio, paths, and driveway
- Cleaned all hard surfaces of algae and moss

**Day 3: Finishing Touches**
- Shaped hedges to a clean, formal finish
- Mulched all borders with fresh bark
- Edged the lawn for a crisp definition
- Cleared gutters and tidied garden furniture

## The Result

The owners were absolutely thrilled! The garden is now a usable, enjoyable outdoor space that they can maintain easily going forward.

## The Numbers

- *Area:* Approximately [X] square metres
- *Time:* [X] days
- *Services:* Garden clearance, hedge trimming, lawn care, power washing
- *Maintenance plan:* Fortnightly visits booked

**Got a garden that needs rescuing? We love a challenge! Book your free quote today.** 📸`,
        },

        'project-clearance': {
            category: 'projects',
            title: '🏡 Garden Rescue: Clearing Years of Overgrowth in [Location]',
            tags: 'garden clearance, rescue, overgrown, project',
            excerpt: 'When this [location] homeowner called us, they couldn\'t see the back fence. Here\'s how we brought their garden back to life.',
            content: `## Garden Rescue: [Location]

**The Brief:** The client had just moved into a property where the garden hadn't been touched for several years. The lawn was knee-height, brambles had taken over the borders, and the hedges were blocking light from the windows.

## The Approach

We planned the clearance in phases:

**Phase 1 — Vegetation Removal**
- Strimmed all overgrown grass and ground cover
- Cut back all brambles and self-seeded trees
- Cleared invasive plants from borders
- Removed all green waste (several trailer loads!)

**Phase 2 — Structure**
- Reduced hedges to proper height and shape
- Pruned overgrown shrubs
- Cleared along fence lines
- Opened up sight lines to reveal the full garden

**Phase 3 — Restoration**
- Mowed the revealed lawn areas
- Applied initial lawn treatment
- Power washed the hidden patio
- Edged all paths and borders

## Client Feedback

*"We couldn't believe it was the same garden. We can finally use our outdoor space and the kids absolutely love it. Thank you so much!"*

## Ongoing Care

The client signed up for our Essential fortnightly package to keep the garden maintained going forward.

**Is your garden hiding under years of growth? Let us reveal its potential! Book a free quote.** 🏡`,
        },

        'project-transformation': {
            category: 'projects',
            title: '✨ Complete Garden Makeover in [Location]',
            tags: 'makeover, transformation, full service, project',
            excerpt: 'A full garden makeover combining clearance, lawn renovation, hedge work, and power washing. What a difference!',
            content: `## Complete Garden Makeover: [Location]

**The Vision:** The client wanted their entire garden refreshed — they were planning a summer party and wanted their outdoor space looking its absolute best.

## Services Delivered

This was a comprehensive package covering every aspect of the garden:

**Lawn Renovation**
- Full scarification to remove thatch and moss
- Aeration across the entire lawn
- Overseeding with premium grass seed
- Applied professional lawn treatment
- Result: thick, green, healthy grass within 6 weeks

**Hedge & Shrub Work**
- Shaped all hedges to formal standard
- Pruned flowering shrubs
- Removed dead and damaged growth
- Applied mulch to base of all hedges

**Hard Surface Cleaning**
- Power washed full patio area
- Cleaned all garden paths
- Removed moss from steps
- Cleaned garden furniture and features

**Border Refresh**
- Weeded all flower beds thoroughly
- Forked over and improved soil
- Applied fresh bark mulch
- Planted seasonal colour in key spots

## The Wow Factor

The transformation was dramatic. The garden went from tired and neglected to a stunning entertaining space in just three days. Perfect timing for the summer!

## Total Investment

This full garden makeover was completed for [£amount] — incredible value for the complete transformation.

**Ready for your own garden makeover? Book a free assessment!** ✨`,
        },

        // ── Business / News ──
        'new-service': {
            category: 'news',
            title: '📢 Exciting News: We Now Offer [New Service]!',
            tags: 'new service, announcement, news',
            excerpt: 'We\'re thrilled to announce a brand new service to help our Cornwall customers even more.',
            content: `## Introducing Our New [Service Name] Service!

We're always looking for ways to better serve our customers across Cornwall, and we're excited to announce our newest offering.

## What Is It?

[Describe the new service in detail — what it involves, who it's for, why it's valuable]

## Why We Added This Service

We've had so many requests from our existing customers for this service. After investing in the right equipment and training, we're now able to offer it to the same high standard as all our other services.

## Key Features

- [Feature 1]
- [Feature 2]
- [Feature 3]
- [Feature 4]

## Introductory Offer

To celebrate the launch, we're offering **[X]% off** all [service name] bookings made this month! Use code **[CODE]** when booking.

## How to Book

You can book this service just like any of our others:

- **Online:** Through our booking page
- **Phone:** 01726 432051
- **Email:** info@gardnersgm.co.uk

**Book your [service name] today and take advantage of our introductory offer!** 📢`,
        },

        'seasonal-offer': {
            category: 'news',
            title: '🏷️ [Season] Special: Save on Garden Services This [Month]!',
            tags: 'offer, discount, seasonal, special',
            excerpt: 'Don\'t miss our [season] special — great savings on our most popular garden services across Cornwall.',
            content: `## [Season] Special Offers!

The [season] is here and it's the perfect time to get your garden sorted. We're running some fantastic deals on our most popular services this [month].

## This Month's Deals

**🌿 Lawn Care Package — [X]% Off**
Full service including mowing, edging, and treatment. Regular price £[X], now just £[X].

**🌳 Hedge Trimming — From £[X]**
All hedge types, any size. Book this month and save.

**🏡 Garden Clearance — Free Quote**
Got an overgrown garden? We'll clear it for less than you think.

**💪 Power Washing — Bundle Deal**
Add power washing to any service booking and save £[X].

## How to Claim

Simply mention this blog post when you book, or use code **[CODE]** online.

## Terms

- Offers valid until [end date]
- Cornwall-wide coverage
- Cannot be combined with other offers
- New and existing customers welcome

**Don't wait — our diary fills up fast during [season]! Book now to secure your slot.** 🏷️`,
        },

        'customer-spotlight': {
            category: 'news',
            title: '⭐ Customer Spotlight: [Name]\'s Garden in [Location]',
            tags: 'customer, spotlight, testimonial, story',
            excerpt: 'Meet one of our fantastic customers and hear about their experience with Gardners Ground Maintenance.',
            content: `## Customer Spotlight: [Name] from [Location]

We love sharing the stories of our amazing customers. Today we're featuring [Name], who we've been looking after for [time period].

## How It Started

[Name] first contacted us because [reason — overgrown garden, new home, needed regular maintenance, etc.]. At the time, their garden was [describe condition].

## What We Do

We visit [Name]'s property [frequency] to provide:

- [Service 1]
- [Service 2]
- [Service 3]

## In Their Words

*"[Customer quote about the service — how it's made their life easier, how the garden looks, what they love about the service]"*

## The Difference

Since we started maintaining [Name]'s garden, the transformation has been remarkable. The lawn is healthy and green, the hedges are perfectly shaped, and the whole property looks fantastic.

## What [Name] Loves Most

*"[Another quote about favourite aspect — reliability, quality, friendliness, etc.]"*

## Could This Be You?

We treat every garden with the same care and attention, whether it's a small front garden or a large estate. If you'd like your outdoor space looking its best, we'd love to help.

**Book a free quote and become our next success story!** ⭐`,
        },

        'cornwall-local': {
            category: 'news',
            title: '📍 Gardening in [Area of Cornwall]: Local Tips & Conditions',
            tags: 'cornwall, local, conditions, guide',
            excerpt: 'Every area of Cornwall has its own gardening challenges. Here\'s our local guide to gardening in [area].',
            content: `## Gardening in [Area of Cornwall]

Cornwall is a diverse county, and different areas present different challenges for gardeners. Here's our expert guide to maintaining a beautiful garden in [area].

## Local Conditions

**Soil Type:** [Clay/Sandy/Loam — describe local soil]
**Exposure:** [Coastal wind/Sheltered valley/Moorland]
**Rainfall:** [Cornwall's west gets more rain than the east]
**Microclimate:** [Describe any local advantages — mild pockets, frost risk, etc.]

## Best Plants for the Area

These plants thrive in [area]:

- [Plant 1 — why it suits the area]
- [Plant 2]
- [Plant 3]
- [Plant 4]
- [Plant 5]

## Common Challenges

Gardeners in [area] often deal with:

- **[Challenge 1]:** [Solution/advice]
- **[Challenge 2]:** [Solution/advice]
- **[Challenge 3]:** [Solution/advice]

## Local Tips

- [Tip specific to the area]
- [Tip about local soil improvement]
- [Tip about wind protection or exposure]
- [Tip about local growing season]

## Our Coverage

We serve [area] and the surrounding areas regularly. Many of our customers in [area] are on our subscription packages for year-round maintenance.

**Based in [area]? Get in touch for a free quote — we'd love to help with your garden!** 📍`,
        },
    };

    // ═══════════════════════════════════════
    //  AI CONTENT GENERATION
    // ═══════════════════════════════════════

    function generateFromTemplate() {
        const templateKey = document.getElementById('aiTemplate').value;
        if (!templateKey) { alert('Select a template first.'); return; }

        const t = TEMPLATES[templateKey];
        if (!t) return;

        // Get current month for seasonal customisation
        const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
        const now = new Date();
        const month = monthNames[now.getMonth()];
        const season = getSeason(now.getMonth());

        // Auto-replace placeholders with current date context
        let title = t.title.replace(/\[Month\]/g, month).replace(/\[Season\]/g, season);
        let content = t.content
            .replace(/\[month\]/g, month.toLowerCase())
            .replace(/\[Month\]/g, month)
            .replace(/\[season\]/g, season.toLowerCase())
            .replace(/\[Season\]/g, season);

        document.getElementById('editTitle').value = title;
        document.getElementById('editCategory').value = t.category;
        document.getElementById('editExcerpt').value = t.excerpt;
        document.getElementById('editContent').value = content;
        document.getElementById('editTags').value = t.tags;

        // Auto-generate social snippets
        generateSocials();
    }

    function generateFromPrompt() {
        const prompt = document.getElementById('aiCustomPrompt').value.trim();
        if (!prompt) { alert('Enter a topic or description.'); return; }

        // Generate a blog post structure from the prompt
        const title = generateTitle(prompt);
        const category = guessCategory(prompt);
        const content = generateContentFromPrompt(prompt);
        const tags = generateTags(prompt);
        const excerpt = prompt.length > 120 ? prompt.substring(0, 120) + '...' : prompt;

        document.getElementById('editTitle').value = title;
        document.getElementById('editCategory').value = category;
        document.getElementById('editExcerpt').value = excerpt;
        document.getElementById('editContent').value = content;
        document.getElementById('editTags').value = tags;

        generateSocials();
        document.getElementById('aiCustomPrompt').value = '';
    }

    function generateTitle(prompt) {
        const p = prompt.toLowerCase();
        // Simple rule-based title generation
        if (p.includes('before') && p.includes('after')) return '📸 Before & After: An Incredible Garden Transformation';
        if (p.includes('clearance') || p.includes('overgrown')) return '🏡 From Overgrown to Outstanding: A Garden Rescue Story';
        if (p.includes('spring')) return '🌱 Spring Garden Guide: Tips for a Fresh Start';
        if (p.includes('summer')) return '☀️ Summer Garden Care: Keeping Your Garden at Its Best';
        if (p.includes('autumn') || p.includes('fall')) return '🍂 Autumn Garden Prep: Getting Ready for Winter';
        if (p.includes('winter')) return '❄️ Winter Garden Protection Tips';
        if (p.includes('lawn')) return '🌿 Expert Lawn Care Tips for Cornwall Gardens';
        if (p.includes('hedge')) return '🌳 Hedge Care: Expert Advice for Perfect Hedges';
        if (p.includes('power wash') || p.includes('pressure wash')) return '💪 The Amazing Difference Power Washing Makes';
        if (p.includes('new') && p.includes('service')) return '📢 Exciting News: New Service Now Available!';
        if (p.includes('offer') || p.includes('discount')) return '🏷️ Special Offer: Great Savings This Month!';
        return '🌿 ' + prompt.charAt(0).toUpperCase() + prompt.slice(1);
    }

    function guessCategory(prompt) {
        const p = prompt.toLowerCase();
        if (p.includes('spring') || p.includes('summer') || p.includes('autumn') || p.includes('winter') || p.includes('season')) return 'seasonal';
        if (p.includes('project') || p.includes('before') || p.includes('after') || p.includes('transformation') || p.includes('clearance job')) return 'projects';
        if (p.includes('news') || p.includes('announce') || p.includes('offer') || p.includes('new service')) return 'news';
        return 'tips';
    }

    function generateTags(prompt) {
        const words = prompt.toLowerCase().split(/\s+/);
        const tagWords = ['lawn', 'hedge', 'garden', 'spring', 'summer', 'autumn', 'winter', 'tips', 'project',
            'clearance', 'mowing', 'trimming', 'cornwall', 'power washing', 'scarifying', 'weeds', 'moss'];
        const found = tagWords.filter(t => words.some(w => w.includes(t)));
        if (found.length < 2) found.push('cornwall', 'gardening');
        return found.join(', ');
    }

    function generateContentFromPrompt(prompt) {
        return `## ${prompt.charAt(0).toUpperCase() + prompt.slice(1)}

[Write your introduction here — what this post is about and why it matters to Cornwall homeowners.]

## Key Points

- [Point 1 — expand on this with practical advice]
- [Point 2 — add details and specifics]
- [Point 3 — include Cornwall-specific information]
- [Point 4 — practical tips the reader can action today]

## What We Recommend

Based on our experience maintaining gardens across Cornwall, here's what we suggest:

**[Main recommendation]** — explain why this matters and how to do it properly.

**[Secondary recommendation]** — additional advice that adds value.

## Our Approach

At Gardners Ground Maintenance, we [describe how this topic relates to your services]. Our team has [X] years of experience and we've seen it all across Cornwall's diverse landscapes.

## Get in Touch

Need professional help with [topic]? We're here for you:

- **Book online:** gardnersgm.co.uk/booking
- **Call us:** 01726 432051
- **Email:** info@gardnersgm.co.uk

**Book today and let us take care of your garden!** 🌿`;
    }

    // ─── Social Media Generation ───
    function generateSocials() {
        const title = document.getElementById('editTitle').value;
        const excerpt = document.getElementById('editExcerpt').value;
        const content = document.getElementById('editContent').value;
        const tags = document.getElementById('editTags').value;

        if (!title) return;

        const hashTags = tags
            ? tags.split(',').map(t => '#' + t.trim().replace(/\s+/g, '')).join(' ')
            : '#CornwallGardening #GardnerGM';

        // Facebook (longer, conversational)
        const fbPost = `${title}\n\n${excerpt || content.substring(0, 200) + '...'}\n\n` +
            `Read the full article on our blog! 👉 [link]\n\n` +
            `Need help with your garden? Book online or call us on 01726 432051 🌿\n\n` +
            `${hashTags} #Cornwall #Gardening #ProfessionalGardener`;
        document.getElementById('fbText').value = fbPost;

        // Instagram (visual, emoji-heavy, hashtag-rich)
        const igCaption = `${title.replace(/[📸🌱☀️🍂❄️🌿🔧💧♻️🏡✨📢🏷️⭐📍]/g, '').trim()} 🌿\n\n` +
            `${excerpt || content.substring(0, 150) + '...'}\n\n` +
            `Double-tap if you love a tidy garden! ❤️\n\n` +
            `📞 01726 432051\n📧 info@gardnersgm.co.uk\n📍 Serving all of Cornwall\n\n` +
            `.\n.\n.\n` +
            `#GardnersGroundMaintenance #CornwallGardener #GardenMaintenance #LawnCare #HedgeTrimming ` +
            `#GardenTransformation #Cornwall #ProfessionalGardener #BeforeAndAfter ` +
            `${hashTags} #GardenDesign #OutdoorLiving #GreenSpaces`;
        document.getElementById('igText').value = igCaption;

        // X/Twitter (short, punchy, 280 char limit)
        let xPost = `${title}\n\n${excerpt ? excerpt.substring(0, 100) : content.substring(0, 100)}...\n\n` +
            `${hashTags.split(' ').slice(0, 3).join(' ')} #Cornwall`;
        if (xPost.length > 280) xPost = xPost.substring(0, 277) + '...';
        document.getElementById('xText').value = xPost;

        updateSocialCounts();
    }

    function updateSocialCounts() {
        document.getElementById('fbCount').textContent = document.getElementById('fbText').value.length;
        document.getElementById('igCount').textContent = document.getElementById('igText').value.length;
        document.getElementById('xCount').textContent = document.getElementById('xText').value.length;
    }

    // ═══════════════════════════════════════
    //  POST CRUD OPERATIONS
    // ═══════════════════════════════════════

    async function loadPosts() {
        try {
            const resp = await fetch(`${WEBHOOK}?action=get_all_blog_posts`);
            const data = await resp.json();
            allPosts = (data.posts || []).sort((a, b) => new Date(b.date) - new Date(a.date));
            renderPostList();
        } catch (err) {
            postList.innerHTML = '<div class="blog-editor-empty"><i class="fas fa-exclamation-triangle"></i><br>Failed to load posts</div>';
        }
    }

    function renderPostList() {
        const filter = statusFilter.value;
        const filtered = filter === 'all' ? allPosts : allPosts.filter(p => p.status === filter);

        if (filtered.length === 0) {
            postList.innerHTML = '<div class="blog-editor-empty"><i class="fas fa-inbox"></i><br>No posts</div>';
            return;
        }

        postList.innerHTML = filtered.map(p => `
            <div class="blog-editor-post-item ${editingId === p.id ? 'active' : ''}" data-id="${p.id}">
                <div class="blog-editor-post-status blog-status-${p.status}"></div>
                <div class="blog-editor-post-info">
                    <strong>${escapeHtml(p.title)}</strong>
                    <span>${formatDate(p.date)} · ${p.category} · ${p.status}</span>
                </div>
            </div>
        `).join('');

        postList.querySelectorAll('.blog-editor-post-item').forEach(item => {
            item.addEventListener('click', () => editPost(item.dataset.id));
        });
    }

    function newPost() {
        editingId = null;
        document.getElementById('editPostId').value = '';
        document.getElementById('editTitle').value = '';
        document.getElementById('editCategory').value = 'tips';
        document.getElementById('editAuthor').value = 'Gardners GM';
        document.getElementById('editExcerpt').value = '';
        document.getElementById('editContent').value = '';
        document.getElementById('editTags').value = '';
        document.getElementById('editImageUrl').value = '';
        document.getElementById('editStatus').value = 'draft';
        document.getElementById('fbText').value = '';
        document.getElementById('igText').value = '';
        document.getElementById('xText').value = '';
        document.getElementById('deletePostBtn').style.display = 'none';
        hideImagePreview();
        updateSocialCounts();
        renderPostList();
    }

    function editPost(id) {
        const post = allPosts.find(p => String(p.id) === String(id));
        if (!post) return;

        editingId = id;
        document.getElementById('editPostId').value = post.id;
        document.getElementById('editTitle').value = post.title || '';
        document.getElementById('editCategory').value = post.category || 'tips';
        document.getElementById('editAuthor').value = post.author || 'Gardners GM';
        document.getElementById('editExcerpt').value = post.excerpt || '';
        document.getElementById('editContent').value = post.content || '';
        document.getElementById('editTags').value = post.tags || '';
        document.getElementById('editImageUrl').value = post.imageUrl || '';
        document.getElementById('editStatus').value = post.status || 'draft';
        document.getElementById('deletePostBtn').style.display = 'inline-flex';

        // Show image preview if available
        if (post.imageUrl) {
            showImagePreview(post.imageUrl);
        } else {
            hideImagePreview();
        }

        // Regenerate social snippets for existing post
        generateSocials();
        renderPostList();
        document.getElementById('editTitle').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    async function savePost(status) {
        const title = document.getElementById('editTitle').value.trim();
        const content = document.getElementById('editContent').value.trim();

        if (!title) { alert('Please enter a post title.'); return; }
        if (!content) { alert('Please write some content.'); return; }

        const payload = {
            action: 'save_blog_post',
            id: editingId || '',
            title: title,
            category: document.getElementById('editCategory').value,
            author: document.getElementById('editAuthor').value.trim() || 'Gardners GM',
            excerpt: document.getElementById('editExcerpt').value.trim(),
            content: content,
            tags: document.getElementById('editTags').value.trim(),
            imageUrl: document.getElementById('editImageUrl').value.trim(),
            status: status,
            socialFb: document.getElementById('fbText').value,
            socialIg: document.getElementById('igText').value,
            socialX: document.getElementById('xText').value
        };

        const btn = status === 'published' ? document.getElementById('publishBtn') : document.getElementById('saveDraftBtn');
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';

        try {
            const resp = await fetch(WEBHOOK, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain' },
                body: JSON.stringify(payload)
            });
            const data = await resp.json();

            if (data.success) {
                editingId = data.id || editingId;
                document.getElementById('editPostId').value = editingId;

                // Telegram notification for published posts
                if (status === 'published') {
                    sendTelegramNotification(title);
                }

                await loadPosts();
                alert(status === 'published' ? 'Post published!' : 'Draft saved!');
            } else {
                alert('Error: ' + (data.error || 'Failed to save.'));
            }
        } catch (err) {
            alert('Failed to save. Please try again.');
        }

        btn.disabled = false;
        btn.innerHTML = status === 'published'
            ? '<i class="fas fa-paper-plane"></i> Publish'
            : '<i class="fas fa-save"></i> Save Draft';
    }

    async function deletePost() {
        if (!editingId) return;
        if (!confirm('Delete this post? This cannot be undone.')) return;

        try {
            const resp = await fetch(WEBHOOK, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain' },
                body: JSON.stringify({ action: 'delete_blog_post', id: editingId })
            });
            const data = await resp.json();

            if (data.success) {
                newPost();
                await loadPosts();
            } else {
                alert('Failed to delete: ' + (data.error || ''));
            }
        } catch (err) {
            alert('Failed to delete. Please try again.');
        }
    }

    // ─── Image Preview Helpers ───
    function showImagePreview(url) {
        const wrap = document.getElementById('imagePreview');
        const img = document.getElementById('imagePreviewImg');
        if (wrap && img) {
            img.src = url;
            wrap.style.display = 'block';
        }
    }

    function hideImagePreview() {
        const wrap = document.getElementById('imagePreview');
        if (wrap) wrap.style.display = 'none';
    }

    async function fetchImage() {
        const title = document.getElementById('editTitle').value.trim();
        const category = document.getElementById('editCategory').value;
        const tags = document.getElementById('editTags').value.trim();

        if (!title && !category && !tags) {
            alert('Enter a title, category or tags first so we can find a relevant image.');
            return;
        }

        const btn = document.getElementById('fetchImageBtn');
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Searching...';

        try {
            const resp = await fetch(WEBHOOK, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain' },
                body: JSON.stringify({
                    action: 'fetch_blog_image',
                    title: title,
                    category: category,
                    tags: tags
                })
            });
            const data = await resp.json();
            if (data.status === 'success' && data.imageUrl) {
                document.getElementById('editImageUrl').value = data.imageUrl;
                showImagePreview(data.imageUrl);
            } else {
                alert('No image found. Try different keywords or paste a URL manually.');
            }
        } catch (err) {
            alert('Failed to fetch image. Please try again.');
        }

        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-search"></i> Fetch Image';
    }

    // ─── Telegram ───
    function sendTelegramNotification(title) {
        const msg = `📝 *New Blog Post Published*\n\n📰 ${title}\n\n_Check your blog page to see it live!_`;
        fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: TELEGRAM_CHAT,
                text: msg,
                parse_mode: 'Markdown'
            })
        }).catch(() => {});
    }

    // ─── Social URL Storage ───
    function saveSocialUrls() {
        const links = {
            facebook: document.getElementById('socialUrlFb').value.trim(),
            instagram: document.getElementById('socialUrlIg').value.trim(),
            twitter: document.getElementById('socialUrlX').value.trim()
        };
        localStorage.setItem('ggm_social_links', JSON.stringify(links));
        alert('Social links saved! They\'ll appear across your website.');
    }

    function loadSocialUrls() {
        const links = JSON.parse(localStorage.getItem('ggm_social_links') || '{}');
        if (links.facebook) document.getElementById('socialUrlFb').value = links.facebook;
        if (links.instagram) document.getElementById('socialUrlIg').value = links.instagram;
        if (links.twitter) document.getElementById('socialUrlX').value = links.twitter;
    }

    // ─── Helpers ───
    function getSeason(month) {
        if (month >= 2 && month <= 4) return 'Spring';
        if (month >= 5 && month <= 7) return 'Summer';
        if (month >= 8 && month <= 10) return 'Autumn';
        return 'Winter';
    }

    function capitalise(str) {
        return str.charAt(0).toUpperCase() + str.slice(1);
    }

    function formatDate(dateStr) {
        try {
            return new Date(dateStr).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
        } catch { return dateStr; }
    }

    function escapeHtml(str) {
        const d = document.createElement('div');
        d.textContent = str || '';
        return d.innerHTML;
    }

})();

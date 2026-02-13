#!/usr/bin/env python3
"""
Gardners Ground Maintenance — Market Intelligence Module

Uses Crawl4AI to scrape competitor pricing, weather forecasts,
and review sentiment for strategic business insights.

Sources:
  • Competitor pricing from CheckATrade, Bark, competitor websites
  • 7-day weather forecast from Met Office / BBC Weather
  • Google/Facebook review monitoring

Output:
  Markdown reports saved to platform/data/market_intel/YYYY-MM-DD.md
  Optionally summarised by Ollama and sent to Telegram

Usage:
  python platform/app/market_intel.py                → Full scrape + report
  python platform/app/market_intel.py --weather-only → Weather forecast only
  python platform/app/market_intel.py --competitors  → Competitor scan only
  python platform/app/market_intel.py --reviews      → Review check only

Dependencies:
  pip install crawl4ai beautifulsoup4 requests
"""

import os
import sys
import json
import re
import logging
from datetime import datetime, timedelta
from pathlib import Path

# Setup paths
SCRIPT_DIR = Path(__file__).parent
DATA_DIR = SCRIPT_DIR / 'data' / 'market_intel'
DATA_DIR.mkdir(parents=True, exist_ok=True)

# Logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [MarketIntel] %(message)s',
    datefmt='%H:%M:%S'
)
log = logging.getLogger(__name__)

# ─── Config ───
OLLAMA_URL = os.environ.get('OLLAMA_URL', 'http://localhost:11434')
OLLAMA_MODEL = os.environ.get('OLLAMA_MODEL', 'llama3.2')

# Cornwall gardening competitors to monitor
COMPETITORS = [
    {
        'name': 'CheckATrade Cornwall Gardeners',
        'url': 'https://www.checkatrade.com/search/gardener/in/cornwall',
        'type': 'directory',
    },
    {
        'name': 'Bark Cornwall Gardening',
        'url': 'https://www.bark.com/en/gb/gardeners/cornwall/',
        'type': 'directory',
    },
    {
        'name': 'Yell Cornwall Gardening',
        'url': 'https://www.yell.com/ucs/UcsSearchAction.do?keywords=gardening+services&location=cornwall',
        'type': 'directory',
    },
]

# Weather source
WEATHER_URL = 'https://www.metoffice.gov.uk/weather/forecast/gbh3r9c6e'  # Cornwall area

# Our Google reviews
GOOGLE_REVIEWS_PLACE = 'gardnersgm'


# ══════════════════════════════════════════════
# WEATHER SCRAPING
# ══════════════════════════════════════════════

async def scrape_weather():
    """Scrape 7-day weather forecast for Cornwall scheduling intelligence."""
    log.info('🌤️ Scraping weather forecast...')
    
    try:
        from crawl4ai import AsyncWebCrawler
        
        async with AsyncWebCrawler() as crawler:
            result = await crawler.arun(url=WEATHER_URL)
            
            if not result.success:
                log.warning(f'Weather scrape failed: {result.error_message}')
                return _fallback_weather()
            
            # Extract forecast data from the page
            forecast = _parse_weather_html(result.html)
            return forecast
            
    except ImportError:
        log.warning('crawl4ai not installed — using fallback weather')
        return _fallback_weather()
    except Exception as e:
        log.error(f'Weather scrape error: {e}')
        return _fallback_weather()


def _parse_weather_html(html):
    """Parse Met Office HTML for forecast data."""
    from bs4 import BeautifulSoup
    soup = BeautifulSoup(html, 'html.parser')
    
    forecast = []
    # Try to find forecast days
    day_elements = soup.select('.forecast-day, .day-summary, [data-day]')
    
    for day_el in day_elements[:7]:
        try:
            day_data = {
                'date': day_el.get('data-day', ''),
                'summary': day_el.get_text(strip=True)[:100],
                'rain': 'rain' in day_el.get_text().lower(),
                'wind': 'wind' in day_el.get_text().lower(),
            }
            
            # Try to extract temperature
            temp_match = re.search(r'(\d{1,2})\s*°', day_el.get_text())
            if temp_match:
                day_data['temp_c'] = int(temp_match.group(1))
            
            forecast.append(day_data)
        except Exception:
            continue
    
    if not forecast:
        # Fallback: extract any temperature/weather mentions from full text
        text = soup.get_text()
        temps = re.findall(r'(\d{1,2})\s*°C', text)
        if temps:
            forecast.append({
                'date': datetime.now().strftime('%Y-%m-%d'),
                'summary': f'Temperatures: {", ".join(temps[:5])}°C',
                'temps_found': [int(t) for t in temps[:7]],
            })
    
    return forecast


def _fallback_weather():
    """Basic weather data using requests if Crawl4AI fails."""
    import requests
    try:
        # Free weather API fallback
        resp = requests.get(
            'https://api.open-meteo.com/v1/forecast',
            params={
                'latitude': 50.27,
                'longitude': -5.05,
                'daily': 'temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max',
                'timezone': 'Europe/London',
                'forecast_days': 7,
            },
            timeout=15
        )
        data = resp.json()
        
        forecast = []
        daily = data.get('daily', {})
        dates = daily.get('time', [])
        max_temps = daily.get('temperature_2m_max', [])
        min_temps = daily.get('temperature_2m_min', [])
        precip = daily.get('precipitation_sum', [])
        wind = daily.get('wind_speed_10m_max', [])
        
        for i, date in enumerate(dates):
            day = {
                'date': date,
                'max_temp': max_temps[i] if i < len(max_temps) else None,
                'min_temp': min_temps[i] if i < len(min_temps) else None,
                'precipitation_mm': precip[i] if i < len(precip) else 0,
                'max_wind_kmh': wind[i] if i < len(wind) else 0,
                'rain': (precip[i] if i < len(precip) else 0) > 1.0,
                'good_for_work': (precip[i] if i < len(precip) else 0) < 2.0 and (wind[i] if i < len(wind) else 0) < 50,
            }
            day_name = datetime.strptime(date, '%Y-%m-%d').strftime('%A')
            day['day_name'] = day_name
            forecast.append(day)
        
        return forecast
    except Exception as e:
        log.error(f'Fallback weather API failed: {e}')
        return []


# ══════════════════════════════════════════════
# COMPETITOR SCRAPING
# ══════════════════════════════════════════════

async def scrape_competitors():
    """Scrape competitor listings for pricing and service intelligence."""
    log.info('🔍 Scraping competitor data...')
    
    results = []
    
    try:
        from crawl4ai import AsyncWebCrawler
        
        async with AsyncWebCrawler() as crawler:
            for comp in COMPETITORS:
                try:
                    log.info(f'  Checking {comp["name"]}...')
                    result = await crawler.arun(url=comp['url'])
                    
                    if result.success:
                        parsed = _parse_competitor_page(result.html, comp)
                        results.append({
                            'source': comp['name'],
                            'url': comp['url'],
                            'data': parsed,
                            'scraped_at': datetime.now().isoformat(),
                        })
                    else:
                        log.warning(f'  Failed to scrape {comp["name"]}: {result.error_message}')
                        
                except Exception as e:
                    log.error(f'  Error scraping {comp["name"]}: {e}')
                    
    except ImportError:
        log.warning('crawl4ai not installed — skipping competitor scraping')
        
    return results


def _parse_competitor_page(html, competitor):
    """Extract pricing and service info from competitor pages."""
    from bs4 import BeautifulSoup
    soup = BeautifulSoup(html, 'html.parser')
    
    data = {
        'businesses_found': 0,
        'price_mentions': [],
        'services_mentioned': [],
        'ratings': [],
    }
    
    text = soup.get_text()
    
    # Find price mentions (£XX, £XX/hour, from £XX)
    prices = re.findall(r'£\s*(\d{1,4}(?:\.\d{2})?)\s*(?:per\s+(?:hour|visit|day|session))?', text, re.I)
    data['price_mentions'] = [f'£{p}' for p in prices[:20]]
    
    # Find ratings (X.X/5, X stars)
    ratings = re.findall(r'(\d\.\d)\s*(?:/5|stars?|out of 5)', text, re.I)
    data['ratings'] = [float(r) for r in ratings[:20]]
    
    # Count business listings
    listing_patterns = soup.select('.search-result, .listing, .tradesperson, .professional-card, .result-card')
    data['businesses_found'] = max(len(listing_patterns), len(data['price_mentions']))
    
    # Common services mentioned
    services = ['lawn mowing', 'hedge trimming', 'garden clearance', 'landscaping', 
                'tree surgery', 'pressure washing', 'fencing', 'patio', 'planting',
                'weeding', 'turfing', 'garden design', 'maintenance']
    text_lower = text.lower()
    data['services_mentioned'] = [s for s in services if s in text_lower]
    
    return data


# ══════════════════════════════════════════════
# REVIEW MONITORING
# ══════════════════════════════════════════════

async def scrape_reviews():
    """Monitor our Google/Facebook reviews for new entries and sentiment."""
    log.info('⭐ Checking reviews...')
    
    reviews = {'google': [], 'summary': ''}
    
    try:
        from crawl4ai import AsyncWebCrawler
        
        async with AsyncWebCrawler() as crawler:
            # Scrape Google Maps reviews page
            google_url = f'https://www.google.com/maps/search/{GOOGLE_REVIEWS_PLACE}+cornwall'
            result = await crawler.arun(url=google_url)
            
            if result.success:
                reviews['google'] = _parse_google_reviews(result.html)
                
    except ImportError:
        log.warning('crawl4ai not installed — skipping review scraping')
    except Exception as e:
        log.error(f'Review scrape error: {e}')
    
    return reviews


def _parse_google_reviews(html):
    """Extract review data from Google Maps results."""
    from bs4 import BeautifulSoup
    soup = BeautifulSoup(html, 'html.parser')
    
    reviews = []
    text = soup.get_text()
    
    # Find star ratings
    stars = re.findall(r'(\d\.\d)\s*stars?', text, re.I)
    review_counts = re.findall(r'(\d+)\s*reviews?', text, re.I)
    
    if stars:
        reviews.append({
            'average_rating': float(stars[0]),
            'review_count': int(review_counts[0]) if review_counts else 0,
        })
    
    return reviews


# ══════════════════════════════════════════════
# OLLAMA SUMMARY
# ══════════════════════════════════════════════

def generate_ai_summary(weather, competitors, reviews):
    """Use Ollama to generate a strategic market intelligence summary."""
    import requests
    
    prompt = f"""You are a business advisor for Gardners Ground Maintenance, a garden care company in Cornwall, UK.

Analyse this market intelligence data and provide actionable recommendations:

## 7-Day Weather Forecast
{json.dumps(weather, indent=2, default=str)}

## Competitor Intelligence  
{json.dumps(competitors, indent=2, default=str)}

## Review Status
{json.dumps(reviews, indent=2, default=str)}

Provide a brief report with:
1. **Weather Impact** — Which days are good for outdoor work? Any scheduling adjustments needed?
2. **Pricing Intelligence** — How do competitor prices compare? Any opportunities?
3. **Review Health** — Current rating status and any actions needed?
4. **This Week's Recommendations** — 3-5 specific actions Chris should take

Keep it concise and actionable. Use British English."""

    try:
        resp = requests.post(
            f'{OLLAMA_URL}/api/generate',
            json={
                'model': OLLAMA_MODEL,
                'prompt': prompt,
                'stream': False,
                'options': {'temperature': 0.5, 'num_predict': 1024},
            },
            timeout=120
        )
        data = resp.json()
        return data.get('response', '').strip()
    except Exception as e:
        log.error(f'Ollama summary failed: {e}')
        return None


# ══════════════════════════════════════════════
# REPORT GENERATION
# ══════════════════════════════════════════════

def generate_report(weather, competitors, reviews, ai_summary=None):
    """Generate a Markdown market intelligence report."""
    today = datetime.now().strftime('%Y-%m-%d')
    report = f"""# Market Intelligence Report — {datetime.now().strftime('%A %d %B %Y')}

Generated by GGM Market Intel Agent

---

## 🌤️ 7-Day Weather Forecast (Cornwall)

"""
    
    if weather:
        report += "| Day | Max°C | Min°C | Rain (mm) | Wind (km/h) | Work? |\n"
        report += "|-----|-------|-------|-----------|-------------|-------|\n"
        for day in weather:
            if 'max_temp' in day:
                work = '✅' if day.get('good_for_work', True) else '❌'
                report += f"| {day.get('day_name', day.get('date', '?'))} | {day.get('max_temp', '?')} | {day.get('min_temp', '?')} | {day.get('precipitation_mm', 0):.1f} | {day.get('max_wind_kmh', 0):.0f} | {work} |\n"
            else:
                report += f"| {day.get('date', '?')} | {day.get('summary', 'N/A')} |\n"
        
        good_days = sum(1 for d in weather if d.get('good_for_work', True))
        report += f"\n**Good working days this week: {good_days}/7**\n"
    else:
        report += "_Weather data unavailable_\n"
    
    report += "\n---\n\n## 🔍 Competitor Intelligence\n\n"
    
    if competitors:
        for comp in competitors:
            data = comp['data']
            report += f"### {comp['source']}\n"
            report += f"- Businesses found: **{data.get('businesses_found', 0)}**\n"
            if data.get('price_mentions'):
                report += f"- Price range: {', '.join(data['price_mentions'][:10])}\n"
            if data.get('ratings'):
                avg_rating = sum(data['ratings']) / len(data['ratings'])
                report += f"- Average rating: **{avg_rating:.1f}/5** ({len(data['ratings'])} rated)\n"
            if data.get('services_mentioned'):
                report += f"- Common services: {', '.join(data['services_mentioned'])}\n"
            report += "\n"
    else:
        report += "_No competitor data available_\n"
    
    report += "\n---\n\n## ⭐ Review Status\n\n"
    
    if reviews.get('google'):
        for r in reviews['google']:
            report += f"- **Google Rating: {r.get('average_rating', '?')}/5** ({r.get('review_count', '?')} reviews)\n"
    else:
        report += "_Review data unavailable_\n"
    
    if ai_summary:
        report += f"\n---\n\n## 🤖 AI Analysis & Recommendations\n\n{ai_summary}\n"
    
    report += f"\n---\n\n_Report generated at {datetime.now().strftime('%H:%M %d/%m/%Y')}_\n"
    
    return report


# ══════════════════════════════════════════════
# MAIN
# ══════════════════════════════════════════════

async def main():
    import argparse
    parser = argparse.ArgumentParser(description='GGM Market Intelligence')
    parser.add_argument('--weather-only', action='store_true', help='Weather forecast only')
    parser.add_argument('--competitors', action='store_true', help='Competitor scan only')
    parser.add_argument('--reviews', action='store_true', help='Review check only')
    parser.add_argument('--no-ai', action='store_true', help='Skip Ollama summary')
    args = parser.parse_args()
    
    do_all = not (args.weather_only or args.competitors or args.reviews)
    
    weather = []
    competitors = []
    reviews = {'google': [], 'summary': ''}
    
    if do_all or args.weather_only:
        weather = await scrape_weather()
        log.info(f'  Weather: {len(weather)} days of forecast data')
    
    if do_all or args.competitors:
        competitors = await scrape_competitors()
        log.info(f'  Competitors: {len(competitors)} sources scraped')
    
    if do_all or args.reviews:
        reviews = await scrape_reviews()
        log.info(f'  Reviews: {len(reviews.get("google", []))} entries found')
    
    # Generate AI summary
    ai_summary = None
    if not args.no_ai and (weather or competitors or reviews.get('google')):
        log.info('🤖 Generating AI summary...')
        ai_summary = generate_ai_summary(weather, competitors, reviews)
    
    # Generate and save report
    report = generate_report(weather, competitors, reviews, ai_summary)
    
    today = datetime.now().strftime('%Y-%m-%d')
    report_path = DATA_DIR / f'{today}.md'
    report_path.write_text(report, encoding='utf-8')
    log.info(f'📄 Report saved to {report_path}')
    
    # Print summary to stdout (for n8n/agent capture)
    print(f'Market intel report generated: {report_path}')
    print(f'Weather days: {len(weather)}, Competitor sources: {len(competitors)}')
    if weather:
        good_days = sum(1 for d in weather if d.get('good_for_work', True))
        print(f'Good working days this week: {good_days}/7')
    
    return report


if __name__ == '__main__':
    import asyncio
    asyncio.run(main())

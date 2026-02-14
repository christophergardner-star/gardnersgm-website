"""
Workflow Optimiser Agent for GGM Hub.
Analyses job patterns, travel efficiency, scheduling gaps, and resource usage
across all 3 nodes, then suggests actionable improvements.

Runs on a weekly schedule (Friday evenings) to give Chris a summary of:
  - Route optimisation opportunities (reduce driving between postcodes)
  - Schedule gaps and clustering suggestions
  - Service demand patterns and seasonal trends
  - Revenue per hour analysis by service type
  - Client retention signals (lapsed customers, overdue follow-ups)
  - Node health summary (uptime, sync status)

Uses local Ollama for natural language analysis. Falls back to rule-based
insights if Ollama is unavailable.
"""

import json
import logging
import time
from datetime import datetime, timedelta
from collections import defaultdict

log = logging.getLogger("ggm.workflow_optimiser")


class WorkflowOptimiser:
    """
    AI-powered workflow optimisation agent.
    Analyses business data and produces actionable recommendations.
    """

    def __init__(self, db, api=None):
        self.db = db
        self.api = api

    def run(self, config_json: str = "{}") -> dict:
        """
        Execute the full optimisation analysis.
        Returns: {title, report, insights: [...], actions: [...]}
        """
        log.info("Workflow optimiser starting analysis...")
        config = json.loads(config_json) if config_json else {}

        # Gather data from all sources
        data = self._gather_data()

        # Run analysis modules
        insights = []
        insights.extend(self._analyse_scheduling(data))
        insights.extend(self._analyse_routes(data))
        insights.extend(self._analyse_revenue(data))
        insights.extend(self._analyse_clients(data))
        insights.extend(self._analyse_nodes(data))

        # Generate AI summary if Ollama available
        ai_summary = self._generate_ai_summary(insights, data)

        # Build report
        report = self._build_report(insights, ai_summary, data)

        # Send to Telegram
        if self.api:
            self._send_telegram_report(report, insights)

        # Store in database
        self._store_report(report, insights)

        log.info(f"Workflow optimiser completed: {len(insights)} insights generated")
        return {
            "title": f"Weekly Workflow Report — {datetime.now().strftime('%d %b %Y')}",
            "report": report,
            "insights": insights,
            "insight_count": len(insights),
        }

    def _gather_data(self) -> dict:
        """Collect all business data needed for analysis."""
        data = {}

        try:
            # Clients/bookings from local DB
            rows = self.db.execute(
                "SELECT * FROM clients ORDER BY date DESC LIMIT 500"
            ).fetchall()
            cols = [d[0] for d in self.db.execute("SELECT * FROM clients LIMIT 0").description]
            data["clients"] = [dict(zip(cols, r)) for r in rows]
        except Exception as e:
            log.warning(f"Could not fetch clients: {e}")
            data["clients"] = []

        try:
            # Invoices
            rows = self.db.execute(
                "SELECT * FROM invoices ORDER BY date DESC LIMIT 200"
            ).fetchall()
            cols = [d[0] for d in self.db.execute("SELECT * FROM invoices LIMIT 0").description]
            data["invoices"] = [dict(zip(cols, r)) for r in rows]
        except Exception:
            data["invoices"] = []

        try:
            # Quotes
            rows = self.db.execute(
                "SELECT * FROM quotes ORDER BY created_at DESC LIMIT 100"
            ).fetchall()
            cols = [d[0] for d in self.db.execute("SELECT * FROM quotes LIMIT 0").description]
            data["quotes"] = [dict(zip(cols, r)) for r in rows]
        except Exception:
            data["quotes"] = []

        try:
            # Agent runs (last 30 days)
            cutoff = (datetime.now() - timedelta(days=30)).isoformat()
            rows = self.db.execute(
                "SELECT * FROM agent_runs WHERE started_at > ? ORDER BY started_at DESC",
                (cutoff,)
            ).fetchall()
            cols = [d[0] for d in self.db.execute("SELECT * FROM agent_runs LIMIT 0").description]
            data["agent_runs"] = [dict(zip(cols, r)) for r in rows]
        except Exception:
            data["agent_runs"] = []

        try:
            # Sync log (last 7 days for health check)
            cutoff = (datetime.now() - timedelta(days=7)).isoformat()
            rows = self.db.execute(
                "SELECT * FROM sync_log WHERE synced_at > ? ORDER BY synced_at DESC LIMIT 100",
                (cutoff,)
            ).fetchall()
            cols = [d[0] for d in self.db.execute("SELECT * FROM sync_log LIMIT 0").description]
            data["sync_log"] = [dict(zip(cols, r)) for r in rows]
        except Exception:
            data["sync_log"] = []

        # Node health via API
        try:
            if self.api:
                node_data = self.api.get("get_node_status")
                data["nodes"] = node_data.get("nodes", [])
            else:
                data["nodes"] = []
        except Exception:
            data["nodes"] = []

        return data

    def _analyse_scheduling(self, data: dict) -> list:
        """Analyse scheduling patterns for optimisation opportunities."""
        insights = []
        clients = data.get("clients", [])
        if not clients:
            return insights

        # Group jobs by date
        jobs_by_date = defaultdict(list)
        for c in clients:
            date = c.get("date", "")
            if date:
                jobs_by_date[date].append(c)

        # Find days with only 1 job (underutilised)
        single_job_days = [d for d, jobs in jobs_by_date.items() if len(jobs) == 1]
        if len(single_job_days) > 3:
            insights.append({
                "category": "scheduling",
                "severity": "medium",
                "title": "Underutilised Days Detected",
                "detail": (
                    f"{len(single_job_days)} days in recent history had only 1 job scheduled. "
                    f"Consider clustering jobs to reduce travel days and increase revenue per day."
                ),
                "action": "Review schedule clustering in the Dispatch tab.",
            })

        # Find days with 5+ jobs (overloaded)
        heavy_days = [d for d, jobs in jobs_by_date.items() if len(jobs) >= 5]
        if heavy_days:
            insights.append({
                "category": "scheduling",
                "severity": "low",
                "title": "Heavy Days Detected",
                "detail": (
                    f"{len(heavy_days)} days had 5+ jobs. Risk of overrun and quality issues. "
                    f"Consider spreading jobs more evenly across the week."
                ),
                "action": "Limit to 4 jobs per day for quality assurance.",
            })

        # Weekend work detection
        weekend_jobs = 0
        for date_str, jobs in jobs_by_date.items():
            try:
                dt = datetime.strptime(date_str[:10], "%Y-%m-%d")
                if dt.weekday() >= 5:
                    weekend_jobs += len(jobs)
            except (ValueError, TypeError):
                pass

        if weekend_jobs > 0:
            insights.append({
                "category": "scheduling",
                "severity": "info",
                "title": f"{weekend_jobs} Weekend Jobs",
                "detail": f"{weekend_jobs} jobs were scheduled on weekends. Consider premium pricing for weekend work.",
                "action": "Add weekend surcharge in pricing config.",
            })

        return insights

    def _analyse_routes(self, data: dict) -> list:
        """Analyse travel patterns for route optimisation."""
        insights = []
        clients = data.get("clients", [])
        if not clients:
            return insights

        # Group jobs by date and check postcode clustering
        jobs_by_date = defaultdict(list)
        for c in clients:
            date = c.get("date", "")
            postcode = c.get("postcode", "")
            if date and postcode:
                jobs_by_date[date].append(postcode)

        # Check for scattered postcodes on same day
        scattered_days = 0
        for date, postcodes in jobs_by_date.items():
            if len(postcodes) < 2:
                continue
            # Extract postcode prefixes (e.g. TR1, TR2, PL1)
            prefixes = set()
            for pc in postcodes:
                parts = pc.strip().split()
                if parts:
                    prefixes.add(parts[0][:3].upper())
            if len(prefixes) > 2:
                scattered_days += 1

        if scattered_days > 2:
            insights.append({
                "category": "routes",
                "severity": "high",
                "title": "Route Inefficiency Detected",
                "detail": (
                    f"{scattered_days} days had jobs in 3+ different postcode areas. "
                    f"This means excessive driving between sites. "
                    f"Try grouping jobs by area: all TR1 jobs on Monday, TR2 on Tuesday, etc."
                ),
                "action": "Use Schedule → Generate to auto-cluster by postcode area.",
            })

        return insights

    def _analyse_revenue(self, data: dict) -> list:
        """Analyse revenue patterns and profitability."""
        insights = []
        invoices = data.get("invoices", [])
        if not invoices:
            return insights

        # Revenue by service type
        revenue_by_service = defaultdict(float)
        count_by_service = defaultdict(int)
        for inv in invoices:
            service = inv.get("service", inv.get("description", "Unknown"))
            try:
                amount = float(inv.get("amount", 0))
            except (ValueError, TypeError):
                amount = 0
            if amount > 0:
                revenue_by_service[service] += amount
                count_by_service[service] += 1

        if revenue_by_service:
            # Find highest and lowest revenue services
            sorted_services = sorted(revenue_by_service.items(), key=lambda x: x[1], reverse=True)
            if len(sorted_services) >= 2:
                top = sorted_services[0]
                bottom = sorted_services[-1]
                insights.append({
                    "category": "revenue",
                    "severity": "info",
                    "title": "Service Revenue Breakdown",
                    "detail": (
                        f"Top earner: {top[0]} (£{top[1]:.0f} from {count_by_service[top[0]]} jobs). "
                        f"Lowest: {bottom[0]} (£{bottom[1]:.0f} from {count_by_service[bottom[0]]} jobs)."
                    ),
                    "action": "Consider promoting high-margin services in marketing.",
                })

        # Outstanding invoices
        outstanding = [inv for inv in invoices
                       if inv.get("status", "").lower() in ("sent", "outstanding", "overdue")]
        if len(outstanding) > 3:
            total_outstanding = sum(float(inv.get("amount", 0)) for inv in outstanding)
            insights.append({
                "category": "revenue",
                "severity": "high",
                "title": f"£{total_outstanding:.0f} Outstanding Across {len(outstanding)} Invoices",
                "detail": (
                    f"{len(outstanding)} invoices are still unpaid. "
                    f"Total outstanding: £{total_outstanding:.0f}. "
                    f"Consider automated payment reminders."
                ),
                "action": "Review Finance → Invoices and send reminders.",
            })

        return insights

    def _analyse_clients(self, data: dict) -> list:
        """Analyse client patterns for retention opportunities."""
        insights = []
        clients = data.get("clients", [])
        if not clients:
            return insights

        # Find lapsed customers (last job > 3 months ago)
        cutoff = (datetime.now() - timedelta(days=90)).strftime("%Y-%m-%d")
        client_last_seen = {}
        for c in clients:
            name = c.get("name", "Unknown")
            date = c.get("date", "")
            if name and date:
                if name not in client_last_seen or date > client_last_seen[name]:
                    client_last_seen[name] = date

        lapsed = [name for name, last in client_last_seen.items() if last < cutoff]
        if len(lapsed) > 5:
            insights.append({
                "category": "clients",
                "severity": "medium",
                "title": f"{len(lapsed)} Lapsed Customers",
                "detail": (
                    f"{len(lapsed)} customers haven't booked in 3+ months. "
                    f"A re-engagement email or seasonal offer could win them back."
                ),
                "action": "Consider a 'We miss you' email campaign via Marketing tab.",
            })

        # Quote conversion rate
        quotes = data.get("quotes", [])
        if quotes:
            accepted = len([q for q in quotes if q.get("status", "").lower() in ("accepted", "confirmed")])
            total = len(quotes)
            rate = (accepted / total * 100) if total > 0 else 0
            if rate < 50 and total >= 5:
                insights.append({
                    "category": "clients",
                    "severity": "medium",
                    "title": f"Quote Conversion Rate: {rate:.0f}%",
                    "detail": (
                        f"Only {accepted} of {total} quotes were accepted ({rate:.0f}%). "
                        f"Industry average is 60-70%. Review pricing or follow-up timing."
                    ),
                    "action": "Check quote follow-up emails are sending. Consider faster response times.",
                })

        return insights

    def _analyse_nodes(self, data: dict) -> list:
        """Analyse node health across the 3-node system."""
        insights = []
        nodes = data.get("nodes", [])

        for node in nodes:
            status = node.get("status", "unknown")
            node_id = node.get("node_id", "unknown")
            version = node.get("version", "?")

            if status == "offline" and node_id == "pc_hub":
                insights.append({
                    "category": "system",
                    "severity": "high",
                    "title": "PC Hub (Node 1) is Offline",
                    "detail": (
                        "The main PC Hub is not responding. Sync, agents, and email automation "
                        "are all paused. Start the PC Hub immediately."
                    ),
                    "action": "Launch GGM Hub on the main PC.",
                })

        # Check sync health
        sync_log = data.get("sync_log", [])
        if sync_log:
            failed_syncs = [s for s in sync_log if s.get("status", "") == "failed"]
            if len(failed_syncs) > 5:
                insights.append({
                    "category": "system",
                    "severity": "medium",
                    "title": f"{len(failed_syncs)} Failed Syncs This Week",
                    "detail": "Multiple sync failures detected. Check network connectivity and GAS quota limits.",
                    "action": "Review System Health tab for details.",
                })

        # Check agent health
        agent_runs = data.get("agent_runs", [])
        if agent_runs:
            failed_agents = [a for a in agent_runs if a.get("status", "") == "failed"]
            if len(failed_agents) > 3:
                insights.append({
                    "category": "system",
                    "severity": "medium",
                    "title": f"{len(failed_agents)} Failed Agent Runs",
                    "detail": "Multiple agent failures in the last 30 days. Check Ollama is running and models are available.",
                    "action": "Verify Ollama: curl http://localhost:11434/api/tags",
                })

        return insights

    def _generate_ai_summary(self, insights: list, data: dict) -> str:
        """Use Ollama to generate a natural language summary of insights."""
        try:
            from . import llm
            if not llm.is_available():
                return ""

            insight_text = "\n".join([
                f"- [{i['severity'].upper()}] {i['title']}: {i['detail']}"
                for i in insights
            ])

            job_count = len(data.get("clients", []))
            invoice_count = len(data.get("invoices", []))

            prompt = f"""You are a business operations advisor for Gardners Ground Maintenance, 
a garden maintenance company in Cornwall. Summarise these weekly insights in 3-4 sentences. 
Be specific, practical, and encouraging. Use plain English.

Data context: {job_count} recent jobs, {invoice_count} invoices analysed.

Insights:
{insight_text}

Write a brief, actionable summary paragraph (max 100 words):"""

            system = (
                "You are a friendly business advisor. Be concise and practical. "
                "Focus on the most impactful actions Chris should take this week. "
                "Write in plain English, not corporate jargon."
            )

            summary = llm.generate(prompt, system=system, max_tokens=200)
            return summary.strip() if summary else ""
        except Exception as e:
            log.warning(f"AI summary generation failed: {e}")
            return ""

    def _build_report(self, insights: list, ai_summary: str, data: dict) -> str:
        """Build a formatted text report."""
        lines = []
        lines.append(f"═══ GGM Workflow Report — {datetime.now().strftime('%A %d %B %Y')} ═══\n")

        if ai_summary:
            lines.append(f"🤖 AI Summary:\n{ai_summary}\n")

        # Group insights by category
        by_category = defaultdict(list)
        for ins in insights:
            by_category[ins["category"]].append(ins)

        category_icons = {
            "scheduling": "📅",
            "routes": "🗺️",
            "revenue": "💷",
            "clients": "👤",
            "system": "🖥️",
        }

        for cat, items in by_category.items():
            icon = category_icons.get(cat, "📊")
            lines.append(f"\n{icon} {cat.upper()}")
            lines.append("─" * 40)
            for item in items:
                sev_icon = {"high": "🔴", "medium": "🟡", "low": "🟢", "info": "ℹ️"}.get(
                    item["severity"], "📎"
                )
                lines.append(f"  {sev_icon} {item['title']}")
                lines.append(f"     {item['detail']}")
                if item.get("action"):
                    lines.append(f"     → {item['action']}")
                lines.append("")

        job_count = len(data.get("clients", []))
        lines.append(f"\n📊 Data analysed: {job_count} jobs, {len(data.get('invoices', []))} invoices, "
                     f"{len(data.get('quotes', []))} quotes, {len(data.get('nodes', []))} nodes")

        return "\n".join(lines)

    def _send_telegram_report(self, report: str, insights: list):
        """Send the report summary to Telegram."""
        try:
            # Send a concise version (Telegram has message length limits)
            high_priority = [i for i in insights if i["severity"] in ("high", "medium")]

            msg = "📊 *Weekly Workflow Report*\n\n"

            if high_priority:
                for item in high_priority[:5]:
                    sev_icon = "🔴" if item["severity"] == "high" else "🟡"
                    msg += f"{sev_icon} *{item['title']}*\n"
                    msg += f"_{item['detail'][:100]}_\n\n"
            else:
                msg += "✅ No major issues detected this week\\!\n\n"

            msg += f"📈 Total insights: {len(insights)}\n"
            msg += "📋 Full report available in GGM Hub → System Health"

            self.api.send_telegram(msg)
            log.info("Workflow report sent to Telegram")
        except Exception as e:
            log.warning(f"Failed to send Telegram report: {e}")

    def _store_report(self, report: str, insights: list):
        """Store the report in the database for Hub UI access."""
        try:
            self.db.set_setting("last_workflow_report", report)
            self.db.set_setting(
                "last_workflow_report_date",
                datetime.now().isoformat()
            )
            self.db.set_setting(
                "last_workflow_insights",
                json.dumps(insights)
            )
            log.info("Workflow report stored in database")
        except Exception as e:
            log.warning(f"Failed to store workflow report: {e}")

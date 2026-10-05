import { useEffect } from 'react';
import {
  ArrowDown, ArrowRight, ArrowUpRight, BadgeCheck, Bike, CalendarDays,
  CarFront, Check, ChevronRight, ClipboardCheck, Gift, Info, Laptop,
  Layers3, Percent, ShieldCheck, Shirt, Smartphone, Store, Tablet, Trophy,
} from 'lucide-react';
import partnershipImage from './assets/partnership.jpg';
import salonImage from '../assets/posters/nexora-gold-salon.jpg';
import styles from './InvestorsPage.module.css';

const rewards = [
  { milestone: 25, trigger: 26, name: 'T-shirt', value: '₹250', icon: Shirt },
  { milestone: 50, trigger: 51, name: 'Samsung Tablet', value: '₹10,000', icon: Tablet },
  { milestone: 100, trigger: 101, name: 'Branded HP Laptop', value: '₹50,000', icon: Laptop },
  { milestone: 250, trigger: 251, name: 'Electric Scooter', value: '₹80,000', icon: Bike },
  { milestone: 500, trigger: 501, name: 'Latest iPhone', value: '₹1,20,000', icon: Smartphone },
  { milestone: 750, trigger: 751, name: 'Royal Enfield 350 cc', value: '₹3,00,000', icon: Bike },
  { milestone: 1000, trigger: 1001, name: 'SUV Car', value: '₹6,00,000', icon: CarFront },
];

function SectionLabel({ number, children }: { number: string; children: string }) {
  return <div className={styles.eyebrow}><span>{number}</span>{children}</div>;
}

export default function InvestorsPage() {
  useEffect(() => {
    const previousTitle = document.title;
    const description = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    const previousDescription = description?.content;
    const viewport = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
    const previousViewport = viewport?.content;
    document.title = 'HOME PAGE | Growth Partner | Nexora';
    if (description) description.content = 'Nexora Growth Partner revenue, commission, onboarding incentive and one-time reward framework.';
    // Enable accessible zoom for this page only; restore the original on exit.
    if (viewport) viewport.content = 'width=device-width, initial-scale=1.0, viewport-fit=cover';
    return () => {
      document.title = previousTitle;
      if (description && previousDescription !== undefined) description.content = previousDescription;
      if (viewport && previousViewport !== undefined) viewport.content = previousViewport;
    };
  }, []);

  return (
    <div className={styles.page} id="investors-top">
      <a className={styles.skipLink} href="#investors-main">Skip to content</a>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <a className={styles.brand} href="#investors-top" aria-label="Nexora — Home Page">
            <span className={styles.brandMark} aria-hidden="true">N<span /></span>
            <span>NEXORA<small>GROWTH PARTNER</small></span>
          </a>
          <nav className={styles.nav} aria-label="Investor page sections">
            <a className={styles.activeLink} href="#investors-top" aria-current="page">Home</a>
            <a href="#revenue-model">Revenue model</a>
            <a href="#reward-framework">Rewards</a>
            <a href="#investor-relevance">Investor relevance</a>
          </nav>
          <a className={styles.headerAction} href="#reward-framework">View framework <ArrowUpRight size={15} aria-hidden="true" /></a>
        </div>
      </header>

      <main id="investors-main" className={styles.main}>
        <section className={styles.hero} aria-labelledby="hero-title">
          <div className={styles.heroCopy}>
            <div className={styles.heroLabel}><span /> HOME PAGE <i /> GROWTH PARTNER</div>
            <h1 id="hero-title">Growth Partner.<br /><span>Revenue &amp; rewards.</span></h1>
            <p className={styles.heroDescription}>Verified collections. Clear commissions.<br />One-time milestone rewards.</p>
            <div className={styles.heroActions}>
              <a className={styles.primaryButton} href="#revenue-model">Explore the model <ArrowUpRight size={18} aria-hidden="true" /></a>
              <a className={styles.textButton} href="#reward-framework">View rewards <ArrowDown size={16} aria-hidden="true" /></a>
            </div>
            <div className={styles.heroFootnote}><ShieldCheck size={16} aria-hidden="true" /> Actual verified collection. Audit-based eligibility.</div>
          </div>
          <div className={styles.heroVisual}>
            <img src={partnershipImage} alt="A business partnership handshake in a black-and-gold salon" width="1264" height="848" fetchPriority="high" />
            <div className={styles.imageShade} />
            <div className={styles.imageTag}><span /> THE NEXORA PARTNERSHIP</div>
            <div className={styles.glassNote}>
              <span className={styles.noteIcon}><BadgeCheck size={24} aria-hidden="true" /></span>
              <div><small>GROWTH PARTNER COMMISSION</small><strong>10% <span>of actual verified collection</span></strong></div>
              <ArrowUpRight size={22} aria-hidden="true" />
            </div>
          </div>
        </section>

        <section id="revenue-model" className={styles.section} aria-labelledby="revenue-title">
          <SectionLabel number="01">THE REVENUE MODEL</SectionLabel>
          <div className={styles.sectionHeading}><h2 id="revenue-title">Growth Partner Revenue<br className={styles.desktopBreak} /> &amp; Commission Model</h2><span className={styles.sectionAside}>Collection. Commission. Settlement.</span></div>
          <div className={styles.modelGrid}>
            <article className={styles.modelCard}>
              <div className={styles.cardTop}><Store size={22} aria-hidden="true" /><span>01 / COLLECTION</span></div>
              <div className={styles.metric}>₹100<span>/day</span></div>
              <h3>Per active shop</h3>
              <p>1 active shop = ₹100/day verified collection.</p>
            </article>
            <article className={`${styles.modelCard} ${styles.goldCard}`}>
              <div className={styles.cardTop}><Percent size={22} aria-hidden="true" /><span>02 / COMMISSION</span></div>
              <div className={styles.metric}>10<span>%</span></div>
              <h3>Actual verified collection</h3>
              <p>Growth Partner commission = 10% of actual verified collection.</p>
            </article>
            <article className={styles.modelCard}>
              <div className={styles.cardTop}><CalendarDays size={22} aria-hidden="true" /><span>03 / SETTLEMENT</span></div>
              <div className={styles.metric}>7<span>days</span></div>
              <h3>Commission settlement</h3>
              <p>Commission settlement = every 7 days.</p>
            </article>
          </div>
        </section>

        <section id="onboarding-incentive" className={`${styles.section} ${styles.onboarding}`} aria-labelledby="onboarding-title">
          <div className={styles.onboardingIntro}>
            <SectionLabel number="02">THE FIRST MILESTONE</SectionLabel>
            <h2 id="onboarding-title">First Onboarding <br />Incentive</h2>
            <span className={styles.pill}><Gift size={13} aria-hidden="true" /> ONE-TIME INCENTIVE</span>
          </div>
          <div className={styles.onboardingBody}>
            <div className={styles.incentiveFlow} aria-hidden="true">
              <div><small>FIRST 15 DAYS</small><strong>₹15,000</strong><span>Qualifying collection</span></div>
              <ArrowRight className={styles.flowArrow} size={20} />
              <div><small>NEXORA · 10%</small><strong>₹1,500</strong><span>Nexora collection share</span></div>
              <ArrowRight className={styles.flowArrow} size={20} />
              <div className={styles.incentiveFinal}><small>GROWTH PARTNER</small><strong>₹150</strong><span>One-time incentive</span></div>
            </div>
            <p className={styles.exactRule}>First 15-day qualifying onboarding collection: ₹15,000 → Nexora 10% = ₹1,500 → Growth Partner one-time onboarding incentive = ₹150.</p>
          </div>
        </section>

        <section id="reward-framework" className={styles.section} aria-labelledby="rewards-title">
          <SectionLabel number="03">MILESTONES THAT MATTER</SectionLabel>
          <div className={styles.sectionHeading}><div><h2 id="rewards-title">Growth Partner Reward Framework</h2><p className={styles.sectionDescription}>Reward triggers on the NEXT shop after milestone completion:</p></div><span className={styles.pill}><Trophy size={13} aria-hidden="true" /> 7 REWARD MILESTONES</span></div>
          <div className={styles.rewardPanel}>
            <div className={styles.tableScroll} role="region" aria-label="Growth Partner milestone rewards" tabIndex={0}>
              <table className={styles.rewardTable} role="table">
                <caption className={styles.srOnly}>One-time Growth Partner rewards. Each reward triggers on the next shop after its milestone and requires an audit of the previous 10 days' verified collection record.</caption>
                <thead role="rowgroup"><tr role="row"><th role="columnheader" scope="col">Shop milestone</th><th role="columnheader" scope="col">Reward trigger</th><th role="columnheader" scope="col">Your reward</th><th role="columnheader" scope="col">Reward value</th></tr></thead>
                <tbody role="rowgroup">{rewards.map(({ milestone, trigger, name, value, icon: Icon }) => (
                  <tr key={milestone} role="row">
                    <th scope="row" role="rowheader" data-label="Shop milestone"><span className={styles.milestone}>{milestone}</span><span className={styles.shopsLabel}> shops</span></th>
                    <td role="cell" data-label="Reward trigger"><span className={styles.trigger}>{milestone}<ArrowRight size={14} aria-hidden="true" /><strong>{trigger}</strong></span><span className={styles.srOnly}> shops</span></td>
                    <td role="cell" data-label="Your reward"><div className={styles.rewardName}><span className={styles.rewardIcon}><Icon size={19} strokeWidth={1.5} aria-hidden="true" /></span><span>{name}</span></div></td>
                    <td role="cell" data-label="Reward value" className={styles.rewardValue}>{value}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
            <div className={styles.tableFooter}><Info size={16} aria-hidden="true" /><p>After 1000 shops, count continues; do not invent additional reward tiers.</p></div>
          </div>
          <div className={styles.eligibilityNotes}>
            <div><ClipboardCheck size={20} aria-hidden="true" /><p>Reward eligibility requires audit of the previous 10 days' verified collection record.</p></div>
            <div><ShieldCheck size={20} aria-hidden="true" /><p>Each milestone reward is ONE TIME per Growth Partner ID.</p></div>
          </div>
        </section>

        <section id="reward-calculation" className={`${styles.section} ${styles.calculation}`} aria-labelledby="calculation-title">
          <div className={styles.calculationIntro}>
            <SectionLabel number="04">VERIFICATION FIRST</SectionLabel>
            <h2 id="calculation-title">10-Day Reward <br />Calculation Formula</h2>
            <p className={styles.sectionDescription}>Reward eligibility requires audit of the previous 10 days' verified collection record.</p>
            <div className={styles.auditBadge}><ShieldCheck size={16} aria-hidden="true" /> 10-day audit ≠ 7-day settlement</div>
          </div>
          <div className={styles.formulaCard}>
            <div className={styles.formulaLabel}><ClipboardCheck size={17} aria-hidden="true" /> REWARD ELIGIBILITY REVIEW</div>
            <p className={styles.formula}><span>10-day verified collection</span><span className={styles.equals}>=</span>Sum of actual verified collection<br />from the previous <em>10 days</em></p>
            <div className={styles.days} aria-hidden="true">{Array.from({ length: 10 }, (_, i) => <span key={i}>{String(i + 1).padStart(2, '0')}</span>)}</div>
            <div className={styles.dayCaption}><span>PREVIOUS 10 DAYS</span><span><Check size={13} aria-hidden="true" /> AUDIT REQUIRED</span></div>
            <div className={styles.formulaBottom}><p>Milestone completed <ChevronRight size={14} aria-hidden="true" /> NEXT shop trigger <ChevronRight size={14} aria-hidden="true" /> 10-day audit</p><small>Reward value follows the milestone table. Commission settlement = every 7 days.</small></div>
          </div>
        </section>

        <section id="investor-relevance" className={`${styles.section} ${styles.relevance}`} aria-labelledby="relevance-title">
          <div className={styles.salonVisual}><img src={salonImage} alt="Black-and-gold salon interior with illuminated mirrors and styling chairs" loading="lazy" width="1408" height="768" /><span><Layers3 size={15} aria-hidden="true" /> THE GROWTH PARTNER FRAMEWORK</span></div>
          <div className={styles.relevanceCopy}>
            <SectionLabel number="05">THE INVESTOR PERSPECTIVE</SectionLabel>
            <h2 id="relevance-title">Investor Relevance</h2>
            <p className={styles.sectionDescription}>A view of the Growth Partner collection, commission and reward framework.</p>
            <ul className={styles.relevanceList}>
              <li><BadgeCheck size={18} aria-hidden="true" /><span>Growth Partner commission = 10% of actual verified collection.</span></li>
              <li><CalendarDays size={18} aria-hidden="true" /><span>Commission settlement = every 7 days.</span></li>
              <li><ShieldCheck size={18} aria-hidden="true" /><span>Each milestone reward is ONE TIME per Growth Partner ID.</span></li>
            </ul>
          </div>
        </section>

        <section id="investor-disclaimer" className={styles.disclaimer} aria-labelledby="disclaimer-title">
          <Info size={21} aria-hidden="true" />
          <div><h2 id="disclaimer-title">Investor Disclaimer</h2><p>This page describes the Growth Partner commission and reward framework. It does not state investor returns, valuation, or revenue projections. Reward eligibility requires audit of the previous 10 days' verified collection record. Each milestone reward is ONE TIME per Growth Partner ID.</p></div>
        </section>
      </main>
      <footer className={styles.footer}><span className={styles.footerBrand}>NEXORA <span>/ GROWTH PARTNER</span></span><span>HOME PAGE</span><a href="#investors-top">Back to top <ArrowUpRight size={15} aria-hidden="true" /></a></footer>
    </div>
  );
}

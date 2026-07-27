import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Button, Card } from '../components/ui/core';
import {
  SlidersHorizontal, Calendar, Play, Save, Trash2,
  Database, AlertCircle, X, ChevronDown, Globe, MapPin
} from 'lucide-react';
import { toast } from 'sonner';
import { Country, State, City } from 'country-state-city';
import { createSearch, deleteSearch, estimateSearch, listSearches, runSearch } from '../services/sourcingApi';

// Real, authoritative country → state → city dataset (ISO 3166 / geonames backed)
const GLOBAL_COUNTRIES = Country.getAllCountries();

export const LeadSearch: React.FC = () => {
  // Individuals = find a specific targeted person; Companies = find whole
  // company profiles instead, with no job-title filter.
  const [searchMode, setSearchMode] = useState<'individuals' | 'companies'>('individuals');

  // Target parameter states
  const [countries, setCountries] = useState<string[]>(['United States', 'Canada']);
  const [states, setStates] = useState<string[]>(['California']);
  const [cities, setCities] = useState<string[]>(['San Francisco']);
  const [industries, setIndustries] = useState<string[]>(['AI & Robotics']);
  const [titles, setTitles] = useState<string[]>(['VP of Sales']);
  const [customIndustry, setCustomIndustry] = useState('');
  const [customDesignation, setCustomDesignation] = useState('');
  const [leadLimit, setLeadLimit] = useState(50);

  // Company size (employees) — Companies mode only. Empty string means "no
  // bound" on that side of the range, not zero.
  const [sizeMin, setSizeMin] = useState<string>('');
  const [sizeMax, setSizeMax] = useState<string>('');
  const sizeMinNum = sizeMin.trim() === '' ? null : Number(sizeMin);
  const sizeMaxNum = sizeMax.trim() === '' ? null : Number(sizeMax);
  const sizeRangeError = sizeMinNum !== null && sizeMaxNum !== null && sizeMinNum > sizeMaxNum;

  // Revenue band(s) — Companies mode only. Empty array means "no revenue
  // constraint". Values must match the backend's fixed band keys.
  const [revenueBands, setRevenueBands] = useState<string[]>([]);
  
  // Search input and dropdown control states
  const [countrySearch, setCountrySearch] = useState('');
  const [stateSearch, setStateSearch] = useState('');
  const [citySearch, setCitySearch] = useState('');
  
  const [showCountryDropdown, setShowCountryDropdown] = useState(false);
  const [showStateDropdown, setShowStateDropdown] = useState(false);
  const [showCityDropdown, setShowCityDropdown] = useState(false);
  
  const [countryError, setCountryError] = useState(false);

  // Advanced filters
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [fundingStages, setFundingStages] = useState<string[]>(['Series A', 'Series B']);
  const [hiringSignal, setHiringSignal] = useState(true);
  const [requiredKeyword, setRequiredKeyword] = useState('B2B');

  // Scheduling states — date and time are kept as separate inputs (rather
  // than one combined datetime-local field) since that's what the user
  // asked for; they're combined into a single unambiguous UTC instant only
  // when the schedule is actually submitted.
  const [scheduledDate, setScheduledDate] = useState('');
  const [scheduledTime, setScheduledTime] = useState('');
  const [recurrence, setRecurrence] = useState('');
  const todayStr = useMemo(() => new Date().toISOString().slice(0, 10), []);

  // Match estimation stats and preview state
  const [matchCount, setMatchCount] = useState<number | null>(null);
  const [isCalculating, setIsCalculating] = useState(false);
  const [previewCompanies, setPreviewCompanies] = useState<any[]>([]);
  const [savedSearches, setSavedSearches] = useState<any[]>([]);

  const fetchSavedSearches = useCallback(async () => {
    try {
      const res = await listSearches();
      const formatted = (res || []).map((s: any) => {
        const paramsParts = [];
        if (s.countries?.length) paramsParts.push(s.countries.join(', '));
        if (s.industries?.length) paramsParts.push(s.industries.join(', '));
        if (s.designations?.length) paramsParts.push(s.designations.join(', '));
        if (s.company_size_min != null || s.company_size_max != null) {
          paramsParts.push(`${s.company_size_min ?? 'Any'}-${s.company_size_max ?? 'Any'} employees`);
        }
        if (s.revenue_bands?.length) paramsParts.push(s.revenue_bands.join(', '));

        let scheduleLabel = 'Run manually';
        if (s.schedule?.type === 'one-time' && s.schedule?.datetime) {
          scheduleLabel = `Runs once on ${new Date(s.schedule.datetime).toLocaleString()}`;
        } else if (s.schedule?.type === 'recurring' && s.schedule?.recurrence) {
          scheduleLabel = `Repeats ${s.schedule.recurrence}`;
        }

        return {
          id: s.id,
          name: s.name,
          parameters: paramsParts.join(' · ') || 'No filters',
          matches: s.lead_count_target || 50,
          lastRun: scheduleLabel,
          raw: s,
        };
      });
      setSavedSearches(formatted);
    } catch (e) {
      console.error(e);
    }
  }, []);

  useEffect(() => {
    fetchSavedSearches();
  }, [fetchSavedSearches]);

  // Recalculate matches live via backend estimation
  useEffect(() => {
    if (countries.length === 0) {
      setMatchCount(0);
      setPreviewCompanies([]);
      return;
    }
    if (searchMode === 'companies' && sizeRangeError) {
      // Don't burn a live SerpAPI probe on a filter that can never match.
      setMatchCount(null);
      setPreviewCompanies([]);
      return;
    }

    setIsCalculating(true);
    const delay = setTimeout(async () => {
      try {
        const finalTitles = customDesignation ? [...titles.filter(x => x !== 'Other'), customDesignation] : titles.filter(x => x !== 'Other');
        const finalIndustries = customIndustry ? [...industries.filter(x => x !== 'Other'), customIndustry] : industries.filter(x => x !== 'Other');

        const res = await estimateSearch({
          countries,
          states,
          cities,
          industries: finalIndustries,
          titles: finalTitles,
          searchMode,
          sizeRange: searchMode === 'companies' ? [sizeMinNum, sizeMaxNum] : [null, null],
          revenueBands: searchMode === 'companies' ? revenueBands : [],
        });
        if (res) {
          setMatchCount(res.match_count);
          setPreviewCompanies(res.preview_companies || []);
        }
      } catch (err) {
        console.error("Failed to fetch search estimate", err);
      } finally {
        setIsCalculating(false);
      }
    }, 500);

    return () => clearTimeout(delay);
  }, [searchMode, countries, states, cities, industries, titles, customDesignation, customIndustry, sizeMin, sizeMax, revenueBands]);

  // Enforce selection order: a state can't outlive its country, a city can't outlive its state.
  useEffect(() => {
    if (countries.length === 0 && (states.length > 0 || cities.length > 0)) {
      setStates([]);
      setCities([]);
    }
  }, [countries.length]); // eslint-disable-line

  useEffect(() => {
    if (states.length === 0 && cities.length > 0) {
      setCities([]);
    }
  }, [states.length]); // eslint-disable-line

  const buildAdvancedFilters = () => ({
    fundingStages,
    hiringSignal,
    requiredKeyword: requiredKeyword.trim(),
  });

  const handleRunSearch = async () => {
    if (countries.length === 0) {
      setCountryError(true);
      toast.error('Target country is mandatory to run lead search.');
      return;
    }
    setCountryError(false);
    if (searchMode === 'companies' && sizeRangeError) {
      toast.error('Minimum company size cannot be greater than maximum.');
      return;
    }

    try {
      toast.info('Starting your search — this runs in the background.');
      const finalTitles = customDesignation ? [...titles.filter(x => x !== 'Other'), customDesignation] : titles.filter(x => x !== 'Other');
      const finalIndustries = customIndustry ? [...industries.filter(x => x !== 'Other'), customIndustry] : industries.filter(x => x !== 'Other');

      const createdSearch = await createSearch({
        name: `Scrape Now: ${finalIndustries.join('/') || 'All Industries'}`,
        countries,
        states,
        cities,
        industries: finalIndustries,
        titles: finalTitles,
        limit: leadLimit,
        sizeRange: searchMode === 'companies' ? [sizeMinNum, sizeMaxNum] : [null, null],
        revenueBands: searchMode === 'companies' ? revenueBands : [],
        advancedFilters: buildAdvancedFilters(),
        schedule: {},
        searchMode,
      });
      await runSearch(createdSearch.id);
      toast.success('Search queued — track its progress in the Job Queue.');
    } catch (err: any) {
      toast.error(err.message || 'Failed to launch lead search.');
    }
  };

  const handleScheduleSearch = async () => {
    if (countries.length === 0) {
      setCountryError(true);
      toast.error('Target country is mandatory to schedule search.');
      return;
    }
    if (!scheduledDate && !recurrence) {
      toast.error('Please specify a future execution date/time or select a recurring frequency.');
      return;
    }
    if (scheduledDate && !scheduledTime) {
      toast.error('Please also select a time for the one-time execution date.');
      return;
    }
    if (searchMode === 'companies' && sizeRangeError) {
      toast.error('Minimum company size cannot be greater than maximum.');
      return;
    }
    setCountryError(false);

    let schedulePayload: { type: string; datetime?: string; recurrence?: string };
    if (scheduledDate) {
      // Combine as local wall-clock time, then convert to a single
      // unambiguous UTC instant (ISO with "Z") — this is what actually
      // fixes the old bug where a bare "2026-07-18T14:30" string was
      // compared directly against server UTC time, firing early/late
      // depending on the user's timezone.
      const localDateTime = new Date(`${scheduledDate}T${scheduledTime}:00`);
      if (Number.isNaN(localDateTime.getTime())) {
        toast.error('Invalid date/time selected.');
        return;
      }
      if (localDateTime.getTime() <= Date.now()) {
        toast.error('Please pick a date/time in the future.');
        return;
      }
      schedulePayload = { type: 'one-time', datetime: localDateTime.toISOString() };
    } else {
      schedulePayload = { type: 'recurring', recurrence };
    }

    try {
      const finalTitles = customDesignation ? [...titles.filter(x => x !== 'Other'), customDesignation] : titles.filter(x => x !== 'Other');
      const finalIndustries = customIndustry ? [...industries.filter(x => x !== 'Other'), customIndustry] : industries.filter(x => x !== 'Other');

      await createSearch({
        name: `Scheduled Search: ${finalIndustries.join('/') || 'All Industries'}`,
        countries,
        states,
        cities,
        industries: finalIndustries,
        titles: finalTitles,
        limit: leadLimit,
        sizeRange: searchMode === 'companies' ? [sizeMinNum, sizeMaxNum] : [null, null],
        revenueBands: searchMode === 'companies' ? revenueBands : [],
        advancedFilters: buildAdvancedFilters(),
        schedule: schedulePayload,
        searchMode,
      });
      toast.success('Search schedule successfully configured — track it in the Jobs Queue "Scheduled" section.');
      setScheduledDate('');
      setScheduledTime('');
      setRecurrence('');
      fetchSavedSearches();
    } catch (err: any) {
      toast.error(err.message || 'Failed to configure schedule.');
    }
  };

  const handleSaveSearch = async () => {
    if (countries.length === 0) {
      setCountryError(true);
      toast.error('Target country is mandatory to save search presets.');
      return;
    }
    setCountryError(false);
    if (searchMode === 'companies' && sizeRangeError) {
      toast.error('Minimum company size cannot be greater than maximum.');
      return;
    }
    try {
      const finalTitles = customDesignation ? [...titles.filter(x => x !== 'Other'), customDesignation] : titles.filter(x => x !== 'Other');
      const finalIndustries = customIndustry ? [...industries.filter(x => x !== 'Other'), customIndustry] : industries.filter(x => x !== 'Other');

      await createSearch({
        name: `Preset: ${finalIndustries.join('/') || 'All Industries'}`,
        countries,
        states,
        cities,
        industries: finalIndustries,
        titles: finalTitles,
        limit: leadLimit,
        sizeRange: searchMode === 'companies' ? [sizeMinNum, sizeMaxNum] : [null, null],
        revenueBands: searchMode === 'companies' ? revenueBands : [],
        advancedFilters: buildAdvancedFilters(),
        schedule: {},
        searchMode,
      });
      toast.success('Target parameters successfully saved to presets.');
      fetchSavedSearches();
    } catch (err: any) {
      toast.error('Failed to save search preset.');
    }
  };

  const handleDeleteSearch = async (id: string) => {
    try {
      await deleteSearch(id);
      toast.success('Preset deleted successfully.');
      fetchSavedSearches();
    } catch (err: any) {
      toast.error('Failed to delete preset.');
    }
  };

  const handleLoadPreset = (rawPreset: any) => {
    setSearchMode(rawPreset.search_mode === 'companies' ? 'companies' : 'individuals');
    if (rawPreset.countries) setCountries(rawPreset.countries);
    if (rawPreset.states) setStates(rawPreset.states);
    if (rawPreset.cities) setCities(rawPreset.cities);
    if (rawPreset.industries) setIndustries(rawPreset.industries);
    if (rawPreset.designations) setTitles(rawPreset.designations);
    if (rawPreset.lead_count_target) setLeadLimit(rawPreset.lead_count_target);
    setSizeMin(typeof rawPreset.company_size_min === 'number' ? String(rawPreset.company_size_min) : '');
    setSizeMax(typeof rawPreset.company_size_max === 'number' ? String(rawPreset.company_size_max) : '');
    setRevenueBands(Array.isArray(rawPreset.revenue_bands) ? rawPreset.revenue_bands : []);
    const advanced = rawPreset.advanced_filters || {};
    if (advanced.fundingStages) setFundingStages(advanced.fundingStages);
    if (typeof advanced.hiringSignal === 'boolean') setHiringSignal(advanced.hiringSignal);
    if (typeof advanced.requiredKeyword === 'string') setRequiredKeyword(advanced.requiredKeyword);
    toast.success('Preset loaded.');
  };

  const presetTitles = ['Founder & CEO', 'VP of Sales', 'Head of Growth', 'Chief Technology Officer', 'Director of Operations', 'Other'];
  const presetIndustries = ['AI & Robotics', 'HealthTech', 'Fintech', 'Clean Energy', 'Cybersecurity', 'SaaS', 'Other'];
  const revenueBandOptions = [
    { value: 'startup', label: 'Startup (<$1M)' },
    { value: 'sme', label: 'SME ($1M-$50M)' },
    { value: 'mid_market', label: 'Mid-Market ($50M-$1B)' },
    { value: 'enterprise', label: 'Enterprise ($1B+)' },
  ];

  // Filters for dropdown selections
  const filteredCountriesList = GLOBAL_COUNTRIES.filter(c =>
    c.name.toLowerCase().includes(countrySearch.toLowerCase()) &&
    !countries.includes(c.name)
  ).slice(0, 50);

  // States are scoped to whichever countries are currently selected — a user
  // can't pick a state before a country, and the list only ever shows states
  // that actually belong to the chosen country/countries.
  const selectedCountryObjs = useMemo(
    () => countries.map(name => GLOBAL_COUNTRIES.find(c => c.name === name)).filter(Boolean) as ReturnType<typeof Country.getAllCountries>,
    [countries]
  );

  const availableStates = useMemo(() => {
    const seen = new Set<string>();
    const combined: { name: string; isoCode: string; countryCode: string }[] = [];
    for (const c of selectedCountryObjs) {
      for (const s of State.getStatesOfCountry(c.isoCode)) {
        const key = `${s.countryCode}|${s.name}`;
        if (!seen.has(key)) {
          seen.add(key);
          combined.push(s);
        }
      }
    }
    return combined;
  }, [selectedCountryObjs]);

  const filteredStatesList = availableStates.filter(s =>
    s.name.toLowerCase().includes(stateSearch.toLowerCase()) &&
    !states.includes(s.name)
  ).slice(0, 50);

  // Cities are scoped to whichever states are currently selected — a user
  // can't pick a city before a state, and the list only shows cities that
  // actually belong to the chosen state(s) within the chosen country/countries.
  const selectedStateObjs = useMemo(
    () => states
      .map(name => availableStates.find(s => s.name === name))
      .filter(Boolean) as { name: string; isoCode: string; countryCode: string }[],
    [states, availableStates]
  );

  const availableCities = useMemo(() => {
    const seen = new Set<string>();
    const combined: { name: string }[] = [];
    for (const s of selectedStateObjs) {
      for (const c of City.getCitiesOfState(s.countryCode, s.isoCode)) {
        if (!seen.has(c.name)) {
          seen.add(c.name);
          combined.push(c);
        }
      }
    }
    return combined;
  }, [selectedStateObjs]);

  const filteredCitiesList = availableCities.filter(c =>
    c.name.toLowerCase().includes(citySearch.toLowerCase()) &&
    !cities.includes(c.name)
  ).slice(0, 50);

  return (
    <div className="space-y-6 fade-in">
      {/* Page Header */}
      <div className="flex items-center justify-between border-b border-border-subtle pb-4">
        <div>
          <h1 className="text-2xl font-heading font-bold text-text-primary">Lead Search</h1>
          <p className="text-xs text-text-secondary mt-1">Specify target buyer criteria to start active lead sourcing crawling.</p>
        </div>
      </div>

      {/* Main Sourcing Panel */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left Form: Parameters (60%) */}
        <Card className="p-6 lg:col-span-2 space-y-6">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-heading font-bold text-text-primary">Define Target Parameters</h3>
            <button 
              onClick={handleSaveSearch}
              className="text-xs text-brand-primary hover:text-brand-primary-hover flex items-center font-heading font-semibold"
            >
              <Save className="w-3.5 h-3.5 mr-1" /> Save Preset
            </button>
          </div>

          <div className="space-y-4">

            {/* Individuals vs Companies search mode */}
            <div>
              <label className="block text-xs font-heading font-semibold text-text-secondary mb-2">What are you searching for?</label>
              <div className="inline-flex rounded-input border border-border-default overflow-hidden">
                <button
                  type="button"
                  onClick={() => setSearchMode('individuals')}
                  className={`px-4 py-2 text-xs font-heading font-semibold transition ${
                    searchMode === 'individuals'
                      ? 'bg-brand-primary text-white'
                      : 'bg-bg-surface text-text-secondary hover:bg-bg-canvas'
                  }`}
                >
                  Individuals
                </button>
                <button
                  type="button"
                  onClick={() => setSearchMode('companies')}
                  className={`px-4 py-2 text-xs font-heading font-semibold transition border-l border-border-default ${
                    searchMode === 'companies'
                      ? 'bg-brand-primary text-white'
                      : 'bg-bg-surface text-text-secondary hover:bg-bg-canvas'
                  }`}
                >
                  Companies
                </button>
              </div>
              <p className="text-[11px] text-text-tertiary mt-1.5">
                {searchMode === 'companies'
                  ? 'Finds whole companies — name, website, summary, activity signals, and a decision-maker where one can genuinely be found. No job title needed.'
                  : 'Finds a specific person by job title, e.g. "VP of Sales".'}
              </p>
            </div>

            {/* Target Countries (Mandatory dropdown search) */}
            <div className="relative">
              <label className="flex items-center justify-between text-xs font-heading font-semibold text-text-secondary mb-1">
                <span>Target Locations / Countries <span className="text-status-error">*</span></span>
                {countryError && <span className="text-[10px] text-status-error font-medium">Please select at least one country</span>}
              </label>

              {/* Selected Country Chips */}
              {countries.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-2.5">
                  {countries.map(cName => {
                    const countryObj = GLOBAL_COUNTRIES.find(gc => gc.name === cName);
                    return (
                      <span 
                        key={cName}
                        className="inline-flex items-center text-xs bg-bg-canvas border border-border-default px-2 py-0.5 rounded-badge text-text-primary font-medium"
                      >
                        <span className="mr-1">{countryObj?.flag || '🌐'}</span>
                        {cName}
                        <button 
                          type="button"
                          onClick={() => setCountries(countries.filter(x => x !== cName))}
                          className="ml-1.5 text-text-tertiary hover:text-text-primary transition"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    );
                  })}
                </div>
              )}

              {/* Dropdown Container */}
              <div className="relative">
                <div className={`flex items-center bg-bg-canvas border rounded-input focus-within:ring-1 focus-within:ring-brand-primary ${countryError && countries.length === 0 ? 'border-status-error ring-1 ring-status-error' : 'border-border-default'}`}>
                  <Globe className="w-4 h-4 text-text-tertiary ml-3" />
                  <input
                    type="text"
                    placeholder="Search and add countries globally (e.g. United States, Germany)..."
                    value={countrySearch}
                    onChange={(e) => {
                      setCountrySearch(e.target.value);
                      setShowCountryDropdown(true);
                    }}
                    onFocus={() => setShowCountryDropdown(true)}
                    className="px-3 py-2 w-full text-sm bg-transparent border-0 text-text-primary focus:outline-none focus:ring-0"
                  />
                  <button
                    type="button"
                    onClick={() => setShowCountryDropdown(!showCountryDropdown)}
                    className="p-2 text-text-tertiary hover:text-text-primary mr-1"
                  >
                    <ChevronDown className="w-4 h-4" />
                  </button>
                </div>

                {showCountryDropdown && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setShowCountryDropdown(false)} />
                    <div className="absolute left-0 right-0 mt-1 max-h-56 overflow-y-auto bg-bg-surface border border-border-default rounded-card shadow-lg z-20 animate-in fade-in duration-100">
                      {filteredCountriesList.length === 0 ? (
                        <div className="p-3 text-xs text-text-tertiary">
                          {countrySearch ? (
                            <button
                              type="button"
                              onClick={() => {
                                setCountries([...countries, countrySearch]);
                                setCountrySearch('');
                                setShowCountryDropdown(false);
                                setCountryError(false);
                              }}
                              className="text-left w-full text-brand-primary font-semibold hover:underline"
                            >
                              + Add custom country "{countrySearch}"
                            </button>
                          ) : (
                            "No more countries available."
                          )}
                        </div>
                      ) : (
                        filteredCountriesList.map(c => (
                          <button
                            key={c.name}
                            type="button"
                            onClick={() => {
                              setCountries([...countries, c.name]);
                              setCountrySearch('');
                              setShowCountryDropdown(false);
                              setCountryError(false);
                            }}
                            className="flex items-center w-full px-3 py-2 text-xs text-text-primary hover:bg-bg-canvas text-left transition"
                          >
                            <span className="mr-2 text-sm">{c.flag}</span>
                            <span>{c.name}</span>
                          </button>
                        ))
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* State & City (Optional, search-enabled) */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              
              {/* State/Region selector */}
              <div className="relative">
                <label className="block text-xs font-heading font-semibold text-text-secondary mb-1">
                  State / Region (Optional)
                  {countries.length === 0 && <span className="text-[10px] text-text-tertiary font-normal ml-1">— select a country first</span>}
                </label>

                {states.length > 0 && (
                  <div className="flex flex-wrap gap-1 mb-2">
                    {states.map(s => (
                      <span
                        key={s}
                        className="inline-flex items-center text-[11px] bg-bg-canvas border border-border-default px-2 py-0.5 rounded-badge text-text-primary"
                      >
                        {s}
                        <button
                          type="button"
                          onClick={() => setStates(states.filter(x => x !== s))}
                          className="ml-1 text-text-tertiary hover:text-text-primary"
                        >
                          <X className="w-2.5 h-2.5" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}

                <div className="relative">
                  <div className={`flex items-center bg-bg-canvas border border-border-default rounded-input focus-within:ring-1 focus-within:ring-brand-primary ${countries.length === 0 ? 'opacity-50' : ''}`}>
                    <MapPin className="w-3.5 h-3.5 text-text-tertiary ml-3" />
                    <input
                      type="text"
                      disabled={countries.length === 0}
                      placeholder={countries.length === 0 ? 'Select a country above first...' : 'Search states/regions in your selected countries...'}
                      value={stateSearch}
                      onChange={(e) => {
                        setStateSearch(e.target.value);
                        setShowStateDropdown(true);
                      }}
                      onFocus={() => countries.length > 0 && setShowStateDropdown(true)}
                      onKeyDown={(e) => {
                        if (countries.length === 0) return;
                        if (e.key === 'Enter' && stateSearch.trim()) {
                          e.preventDefault();
                          if (!states.includes(stateSearch.trim())) {
                            setStates([...states, stateSearch.trim()]);
                          }
                          setStateSearch('');
                          setShowStateDropdown(false);
                        }
                      }}
                      className="px-2.5 py-1.5 w-full text-xs bg-transparent border-0 text-text-primary focus:outline-none focus:ring-0 disabled:cursor-not-allowed"
                    />
                  </div>

                  {showStateDropdown && countries.length > 0 && (
                    <>
                      <div className="fixed inset-0 z-10" onClick={() => setShowStateDropdown(false)} />
                      <div className="absolute left-0 right-0 mt-1 max-h-40 overflow-y-auto bg-bg-surface border border-border-default rounded-card shadow-md z-20">
                        {filteredStatesList.length === 0 ? (
                          <div className="p-2.5 text-xs text-text-tertiary">
                            {stateSearch ? (
                              <button
                                type="button"
                                onClick={() => {
                                  setStates([...states, stateSearch]);
                                  setStateSearch('');
                                  setShowStateDropdown(false);
                                }}
                                className="text-left w-full text-brand-primary font-semibold hover:underline"
                              >
                                + Add "{stateSearch}"
                              </button>
                            ) : (
                              "No more states found for your selected countries"
                            )}
                          </div>
                        ) : (
                          filteredStatesList.map(s => (
                            <button
                              key={`${s.countryCode}-${s.name}`}
                              type="button"
                              onClick={() => {
                                setStates([...states, s.name]);
                                setStateSearch('');
                                setShowStateDropdown(false);
                              }}
                              className="block w-full px-2.5 py-1.5 text-xs text-text-primary hover:bg-bg-canvas text-left"
                            >
                              {s.name}
                            </button>
                          ))
                        )}
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* City selector */}
              <div className="relative">
                <label className="block text-xs font-heading font-semibold text-text-secondary mb-1">
                  City (Optional)
                  {states.length === 0 && <span className="text-[10px] text-text-tertiary font-normal ml-1">— select a state first</span>}
                </label>

                {cities.length > 0 && (
                  <div className="flex flex-wrap gap-1 mb-2">
                    {cities.map(c => (
                      <span
                        key={c}
                        className="inline-flex items-center text-[11px] bg-bg-canvas border border-border-default px-2 py-0.5 rounded-badge text-text-primary"
                      >
                        {c}
                        <button
                          type="button"
                          onClick={() => setCities(cities.filter(x => x !== c))}
                          className="ml-1 text-text-tertiary hover:text-text-primary"
                        >
                          <X className="w-2.5 h-2.5" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}

                <div className="relative">
                  <div className={`flex items-center bg-bg-canvas border border-border-default rounded-input focus-within:ring-1 focus-within:ring-brand-primary ${states.length === 0 ? 'opacity-50' : ''}`}>
                    <MapPin className="w-3.5 h-3.5 text-text-tertiary ml-3" />
                    <input
                      type="text"
                      disabled={states.length === 0}
                      placeholder={states.length === 0 ? 'Select a state above first...' : 'Search cities in your selected states...'}
                      value={citySearch}
                      onChange={(e) => {
                        setCitySearch(e.target.value);
                        setShowCityDropdown(true);
                      }}
                      onFocus={() => states.length > 0 && setShowCityDropdown(true)}
                      onKeyDown={(e) => {
                        if (states.length === 0) return;
                        if (e.key === 'Enter' && citySearch.trim()) {
                          e.preventDefault();
                          if (!cities.includes(citySearch.trim())) {
                            setCities([...cities, citySearch.trim()]);
                          }
                          setCitySearch('');
                          setShowCityDropdown(false);
                        }
                      }}
                      className="px-2.5 py-1.5 w-full text-xs bg-transparent border-0 text-text-primary focus:outline-none focus:ring-0 disabled:cursor-not-allowed"
                    />
                  </div>

                  {showCityDropdown && states.length > 0 && (
                    <>
                      <div className="fixed inset-0 z-10" onClick={() => setShowCityDropdown(false)} />
                      <div className="absolute left-0 right-0 mt-1 max-h-40 overflow-y-auto bg-bg-surface border border-border-default rounded-card shadow-md z-20">
                        {filteredCitiesList.length === 0 ? (
                          <div className="p-2.5 text-xs text-text-tertiary">
                            {citySearch ? (
                              <button
                                type="button"
                                onClick={() => {
                                  setCities([...cities, citySearch]);
                                  setCitySearch('');
                                  setShowCityDropdown(false);
                                }}
                                className="text-left w-full text-brand-primary font-semibold hover:underline"
                              >
                                + Add "{citySearch}"
                              </button>
                            ) : (
                              "No more cities found for your selected states"
                            )}
                          </div>
                        ) : (
                          filteredCitiesList.map(c => (
                            <button
                              key={c.name}
                              type="button"
                              onClick={() => {
                                setCities([...cities, c.name]);
                                setCitySearch('');
                                setShowCityDropdown(false);
                              }}
                              className="block w-full px-2.5 py-1.5 text-xs text-text-primary hover:bg-bg-canvas text-left"
                            >
                              {c.name}
                            </button>
                          ))
                        )}
                      </div>
                    </>
                  )}
                </div>
              </div>

            </div>

            {/* Target Industry taxonomy */}
            <div>
              <label className="block text-xs font-heading font-semibold text-text-secondary mb-2">Target Industries</label>
              <div className="flex flex-wrap gap-1.5">
                {presetIndustries.map(ind => {
                  const selected = industries.includes(ind);
                  return (
                    <button
                      key={ind}
                      type="button"
                      onClick={() => {
                        if (selected) setIndustries(industries.filter(x => x !== ind));
                        else setIndustries([...industries, ind]);
                      }}
                      className={`text-xs px-2.5 py-1 rounded-badge border transition ${
                        selected 
                          ? 'bg-brand-primary text-white border-brand-primary font-medium'
                          : 'bg-bg-surface hover:bg-bg-canvas text-text-secondary border-border-default'
                      }`}
                    >
                      {ind}
                    </button>
                  );
                })}
                {/* Dynamically render custom added industries that are not in the presets */}
                {industries.filter(ind => !presetIndustries.includes(ind) && ind !== 'Other').map(ind => (
                  <button
                    key={ind}
                    type="button"
                    onClick={() => setIndustries(industries.filter(x => x !== ind))}
                    className="text-xs px-2.5 py-1 rounded-badge border bg-brand-primary text-white border-brand-primary font-medium transition flex items-center animate-in zoom-in-95 duration-100"
                  >
                    <span>{ind}</span>
                    <X className="w-3 h-3 ml-1.5" />
                  </button>
                ))}
              </div>

              {/* Dynamic Other input for custom Industries */}
              {industries.includes('Other') && (
                <div className="flex gap-2 mt-2 max-w-md animate-in slide-in-from-top-1 duration-150">
                  <input
                    type="text"
                    value={customIndustry}
                    onChange={(e) => setCustomIndustry(e.target.value)}
                    placeholder="Enter custom industry (e.g. EdTech, Logistics)..."
                    className="px-3 py-1.5 w-full text-xs bg-bg-canvas border border-border-default rounded-input text-text-primary focus:outline-none focus:ring-1 focus:ring-brand-primary"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && customIndustry.trim()) {
                        e.preventDefault();
                        if (!industries.includes(customIndustry.trim())) {
                          setIndustries([...industries.filter(x => x !== 'Other'), customIndustry.trim()]);
                        } else {
                          setIndustries(industries.filter(x => x !== 'Other'));
                        }
                        setCustomIndustry('');
                      }
                    }}
                  />
                  <Button
                    variant="outline"
                    onClick={() => {
                      if (customIndustry.trim()) {
                        if (!industries.includes(customIndustry.trim())) {
                          setIndustries([...industries.filter(x => x !== 'Other'), customIndustry.trim()]);
                        } else {
                          setIndustries(industries.filter(x => x !== 'Other'));
                        }
                        setCustomIndustry('');
                      }
                    }}
                    className="h-[32px] px-3 text-xs"
                  >
                    Add
                  </Button>
                </div>
              )}
            </div>

            {/* Designations / job titles — only applies to Individuals mode */}
            {searchMode === 'individuals' && (
            <div>
              <label className="block text-xs font-heading font-semibold text-text-secondary mb-2">Target Designations / Job Titles</label>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {presetTitles.map(t => {
                  const selected = titles.includes(t);
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => {
                        if (selected) setTitles(titles.filter(x => x !== t));
                        else setTitles([...titles, t]);
                      }}
                      className={`text-xs px-2.5 py-1 rounded-badge border transition ${
                        selected 
                          ? 'bg-brand-primary text-white border-brand-primary font-medium'
                          : 'bg-bg-surface hover:bg-bg-canvas text-text-secondary border-border-default'
                      }`}
                    >
                      {t}
                    </button>
                  );
                })}
                {/* Dynamically render custom added designations that are not in the presets */}
                {titles.filter(t => !presetTitles.includes(t) && t !== 'Other').map(t => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setTitles(titles.filter(x => x !== t))}
                    className="text-xs px-2.5 py-1 rounded-badge border bg-brand-primary text-white border-brand-primary font-medium transition flex items-center animate-in zoom-in-95 duration-100"
                  >
                    <span>{t}</span>
                    <X className="w-3 h-3 ml-1.5" />
                  </button>
                ))}
              </div>

              {/* Dynamic Other input for custom Designations */}
              {titles.includes('Other') && (
                <div className="flex gap-2 mt-2 max-w-md animate-in slide-in-from-top-1 duration-150">
                  <input
                    type="text"
                    value={customDesignation}
                    onChange={(e) => setCustomDesignation(e.target.value)}
                    placeholder="Enter custom job title (e.g. Talent Acquisition, VP Engineering)..."
                    className="px-3 py-1.5 w-full text-xs bg-bg-canvas border border-border-default rounded-input text-text-primary focus:outline-none focus:ring-1 focus:ring-brand-primary"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && customDesignation.trim()) {
                        e.preventDefault();
                        if (!titles.includes(customDesignation.trim())) {
                          setTitles([...titles.filter(x => x !== 'Other'), customDesignation.trim()]);
                        } else {
                          setTitles(titles.filter(x => x !== 'Other'));
                        }
                        setCustomDesignation('');
                      }
                    }}
                  />
                  <Button
                    variant="outline"
                    onClick={() => {
                      if (customDesignation.trim()) {
                        if (!titles.includes(customDesignation.trim())) {
                          setTitles([...titles.filter(x => x !== 'Other'), customDesignation.trim()]);
                        } else {
                          setTitles(titles.filter(x => x !== 'Other'));
                        }
                        setCustomDesignation('');
                      }
                    }}
                    className="h-[32px] px-3 text-xs"
                  >
                    Add
                  </Button>
                </div>
              )}
            </div>
            )}

            {/* Numeric lead limit search parameter */}
            <div className="pt-2 max-w-md">
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-heading font-semibold text-text-secondary">Number of Leads to Find</label>
                <span className="text-[10px] text-text-tertiary">Between 10–500 per search</span>
              </div>
              <input
                type="number"
                min={10}
                max={500}
                value={leadLimit}
                onChange={(e) => setLeadLimit(Number(e.target.value))}
                className="px-3 py-2 w-full text-sm bg-bg-canvas border border-border-default rounded-input text-text-primary focus:outline-none focus:ring-1 focus:ring-brand-primary"
              />
            </div>

            {/* Company size (employees) — Companies mode only */}
            {searchMode === 'companies' && (
              <div className="pt-2 max-w-md">
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-heading font-semibold text-text-secondary">Company Size (Employees)</label>
                  <span className="text-[10px] text-text-tertiary">Optional — leave blank for no limit</span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <input
                    type="number"
                    min={0}
                    placeholder="Minimum"
                    value={sizeMin}
                    onChange={(e) => setSizeMin(e.target.value)}
                    className={`px-3 py-2 w-full text-sm bg-bg-canvas border rounded-input text-text-primary focus:outline-none focus:ring-1 focus:ring-brand-primary ${sizeRangeError ? 'border-status-error ring-1 ring-status-error' : 'border-border-default'}`}
                  />
                  <input
                    type="number"
                    min={0}
                    placeholder="Maximum"
                    value={sizeMax}
                    onChange={(e) => setSizeMax(e.target.value)}
                    className={`px-3 py-2 w-full text-sm bg-bg-canvas border rounded-input text-text-primary focus:outline-none focus:ring-1 focus:ring-brand-primary ${sizeRangeError ? 'border-status-error ring-1 ring-status-error' : 'border-border-default'}`}
                  />
                </div>
                {sizeRangeError ? (
                  <p className="text-[10px] text-status-error mt-1">Minimum can't be greater than maximum.</p>
                ) : (
                  <p className="text-[10px] text-text-tertiary mt-1">
                    Only companies whose real, LinkedIn-published headcount falls in this range are returned — an unconfirmed size is excluded, never guessed.
                  </p>
                )}
              </div>
            )}

            {/* Revenue range — Companies mode only */}
            {searchMode === 'companies' && (
              <div className="max-w-md">
                <label className="block text-xs font-heading font-semibold text-text-secondary mb-2">Revenue Range</label>
                <div className="flex flex-wrap gap-1.5">
                  {revenueBandOptions.map(band => {
                    const selected = revenueBands.includes(band.value);
                    return (
                      <button
                        key={band.value}
                        type="button"
                        onClick={() => {
                          if (selected) setRevenueBands(revenueBands.filter(x => x !== band.value));
                          else setRevenueBands([...revenueBands, band.value]);
                        }}
                        className={`text-xs px-2.5 py-1 rounded-badge border transition ${
                          selected
                            ? 'bg-brand-primary text-white border-brand-primary font-medium'
                            : 'bg-bg-surface hover:bg-bg-canvas text-text-secondary border-border-default'
                        }`}
                      >
                        {band.label}
                      </button>
                    );
                  })}
                </div>
                <p className="text-[10px] text-text-tertiary mt-1.5">
                  Optional — leave unselected for no revenue constraint. Only companies with a confirmed, publicly reported revenue in a selected tier are returned; an unconfirmed revenue is excluded, never guessed.
                </p>
              </div>
            )}

            {/* Advanced Filters */}
            <div className="border-t border-border-subtle pt-4">
              <button
                type="button"
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="flex items-center text-xs text-text-secondary hover:text-text-primary font-heading font-semibold"
              >
                <SlidersHorizontal className="w-3.5 h-3.5 mr-1" />
                {showAdvanced ? 'Hide Advanced Filters' : 'Show Advanced Filters'}
              </button>

              {showAdvanced && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-3 bg-bg-canvas p-4 rounded-card border border-border-subtle animate-in fade-in duration-150">
                  <div className="space-y-3">
                    <div>
                      <span className="block text-xs font-heading font-semibold text-text-secondary mb-1">Funding Stages</span>
                      <p className="text-[10px] text-text-tertiary mb-1.5">Added to your search terms to narrow results.</p>
                      <div className="flex gap-2">
                        {['Seed', 'Series A', 'Series B', 'Series C'].map(stg => {
                          const has = fundingStages.includes(stg);
                          return (
                            <button
                              key={stg}
                              type="button"
                              onClick={() => {
                                if (has) setFundingStages(fundingStages.filter(s => s !== stg));
                                else setFundingStages([...fundingStages, stg]);
                              }}
                              className={`text-[10px] px-2 py-1 rounded border ${has ? 'bg-bg-surface border-brand-primary text-brand-primary font-semibold' : 'border-border-default text-text-secondary'}`}
                            >
                              {stg}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <label className="flex items-center text-xs text-text-secondary cursor-pointer mt-2">
                      <input
                        type="checkbox"
                        checked={hiringSignal}
                        onChange={(e) => setHiringSignal(e.target.checked)}
                        className="mr-2 rounded border-border-default text-brand-primary focus:ring-brand-primary"
                      />
                      <span>Prioritize companies that mention active hiring</span>
                    </label>
                  </div>

                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs font-heading font-semibold text-text-secondary mb-1">Required Keyword</label>
                      <input
                        type="text"
                        value={requiredKeyword}
                        onChange={(e) => setRequiredKeyword(e.target.value)}
                        placeholder="e.g. B2B, Remote, Security, AI..."
                        className="px-2.5 py-1.5 w-full text-xs bg-bg-surface border border-border-default rounded-input text-text-primary focus:outline-none"
                      />
                    </div>

                    <label className="flex items-center text-xs text-text-tertiary cursor-not-allowed" title="Connect a CRM in Integrations to enable this filter">
                      <input
                        type="checkbox"
                        checked={false}
                        disabled
                        className="mr-2 rounded border-border-default"
                      />
                      <span>Exclude existing CRM contacts — no CRM connected yet</span>
                    </label>
                  </div>
                </div>
              )}
            </div>

            {/* Scheduling Options */}
            <div className="border-t border-border-subtle pt-4 space-y-3">
              <div className="flex items-center space-x-2">
                <Calendar className="w-4 h-4 text-brand-primary" />
                <span className="text-xs font-heading font-semibold text-text-primary">Schedule Scrape Sourcing</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-bg-canvas p-3 rounded-card border border-border-subtle">
                <div>
                  <label className="block text-[10px] font-heading font-semibold text-text-secondary mb-1">One-Time Future Execution</label>
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="date"
                      value={scheduledDate}
                      min={todayStr}
                      onChange={(e) => setScheduledDate(e.target.value)}
                      className="px-3 py-1.5 w-full text-xs bg-bg-surface border border-border-default rounded-input text-text-primary focus:outline-none focus:ring-1 focus:ring-brand-primary"
                    />
                    <input
                      type="time"
                      value={scheduledTime}
                      onChange={(e) => setScheduledTime(e.target.value)}
                      className="px-3 py-1.5 w-full text-xs bg-bg-surface border border-border-default rounded-input text-text-primary focus:outline-none focus:ring-1 focus:ring-brand-primary"
                    />
                  </div>
                  <p className="text-[10px] text-text-tertiary mt-1">Pick a date, then a time — runs at that moment in your local timezone.</p>
                </div>
                <div>
                  <label className="block text-[10px] font-heading font-semibold text-text-secondary mb-1">Recurring Frequency</label>
                  <select
                    value={recurrence}
                    onChange={(e) => setRecurrence(e.target.value)}
                    disabled={!!scheduledDate}
                    className="px-3 py-1.5 w-full text-xs bg-bg-surface border border-border-default rounded-input text-text-primary focus:outline-none focus:ring-1 focus:ring-brand-primary disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <option value="">None (One-time only)</option>
                    <option value="daily">Every Day</option>
                    <option value="weekly">Every Week</option>
                    <option value="monthly">Every Month</option>
                  </select>
                  {scheduledDate && <p className="text-[10px] text-text-tertiary mt-1">Clear the date above to use a recurring schedule instead.</p>}
                </div>
              </div>
            </div>

          </div>

          {/* Action Footer */}
          <div className="flex items-center justify-end space-x-3 border-t border-border-subtle pt-4">
            <Button
              variant="outline"
              onClick={handleSaveSearch}
            >
              Save as draft
            </Button>
            <Button
              variant="outline"
              onClick={handleScheduleSearch}
              icon={Calendar}
            >
              Schedule Scrape
            </Button>
            <Button
              variant="primary"
              onClick={handleRunSearch}
              icon={Play}
            >
              Scrape Now
            </Button>
          </div>
        </Card>

        {/* Right Sidebar: Match Estimation & Preview (40%) */}
        <div className="space-y-6">
          
          {/* Match Count card */}
          <Card className="p-5 bg-brand-primary text-white relative overflow-hidden">
            <div className="absolute inset-0 opacity-10 pointer-events-none bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-white via-transparent to-transparent" />
            <h4 className="text-xs uppercase font-heading font-semibold tracking-wider opacity-85">Sample Matches Found</h4>

            <div className="mt-4 flex items-baseline space-x-2">
              {isCalculating ? (
                <span className="text-4xl font-heading font-bold tracking-tight opacity-50">—</span>
              ) : countries.length === 0 ? (
                <span className="text-sm opacity-70 mt-2 block">Select a country to see real sample matches</span>
              ) : matchCount === null ? (
                <span className="text-4xl font-heading font-bold tracking-tight opacity-50">...</span>
              ) : (
                <span className="text-4xl font-heading font-bold tracking-tight tabular-nums">{matchCount.toLocaleString()}</span>
              )}
              {matchCount !== null && !isCalculating && countries.length > 0 && (
                <span className="text-xs opacity-75">real {searchMode === 'companies' ? 'companies' : 'profiles'} previewed</span>
              )}
            </div>

            {isCalculating && (
              <p className="text-[11px] opacity-70 mt-2 animate-pulse">Searching for real matches...</p>
            )}

            {matchCount !== null && !isCalculating && countries.length > 0 && (
              <div className="mt-4 text-xs opacity-85 border-t border-white/10 pt-3 space-y-2">
                <div className="flex items-center space-x-1.5 text-[10px] text-brand-accent font-semibold">
                  <Database className="w-3.5 h-3.5" />
                  <span>Source: real-time LinkedIn &amp; web search</span>
                </div>
                <p className="opacity-75">This is a small live sample. Run the full search to discover every matching lead.</p>
              </div>
            )}
          </Card>

          {/* Sourced Previews */}
          <Card className="p-5 space-y-4">
            <div>
              <h4 className="text-xs font-heading font-bold text-text-primary uppercase tracking-wider">Sample Company Previews</h4>
              <p className="text-[11px] text-text-secondary mt-0.5">Real, live-queried matches for your selected criteria.</p>
            </div>

            {isCalculating && (
              <div className="space-y-2">
                {[1,2,3].map(i => (
                  <div key={i} className="h-12 bg-bg-canvas rounded-card border border-border-subtle animate-pulse" />
                ))}
              </div>
            )}

            {!isCalculating && previewCompanies.length === 0 && countries.length === 0 && (
              <div className="text-xs text-text-tertiary text-center py-6 italic">Select a country to load live company previews</div>
            )}

            {!isCalculating && previewCompanies.length === 0 && countries.length > 0 && (
              <div className="text-xs text-text-tertiary text-center py-6 italic">
                No preview companies found yet. Try a different industry{searchMode === 'individuals' ? ' or title filter' : ''}.
              </div>
            )}

            {!isCalculating && previewCompanies.length > 0 && (
              <div className="space-y-3">
                {previewCompanies.map((c, i) => (
                  <div key={i} className="flex items-center justify-between p-2.5 bg-bg-canvas rounded-card border border-border-subtle">
                    <div>
                      <span className="text-xs font-heading font-semibold text-text-primary block">{c.name}</span>
                      <span className="text-[10px] text-text-secondary block mt-0.5">{c.domain || 'Not available'} · {c.size || 'Not available'}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="flex items-center space-x-2 text-xs text-text-tertiary bg-bg-canvas/50 p-2.5 rounded border border-border-subtle">
              <AlertCircle className="w-4 h-4 shrink-0 text-text-secondary" />
              <span>Previews are live-fetched. Full scrape discovers fresh contacts.</span>
            </div>
          </Card>

        </div>
      </div>

      {/* Saved Searches presets */}
      <Card className="p-5">
        <h3 className="text-sm font-heading font-bold text-text-primary mb-4">Saved Sourcing Configurations</h3>
        
        {savedSearches.length === 0 ? (
          <div className="text-center py-10 text-text-tertiary border border-dashed border-border-default rounded-card">
            <Database className="w-8 h-8 mx-auto mb-3 opacity-40" />
            <p className="text-sm font-heading font-semibold text-text-secondary">No Saved Configurations</p>
            <p className="text-xs mt-1">Fill in your target parameters above and click <strong>Save as Draft</strong> to save your first preset.</p>
          </div>
        ) : (
          <div className="border border-border-subtle rounded-card bg-bg-surface overflow-hidden">
            <table className="w-full border-collapse text-left">
              <thead className="bg-bg-canvas border-b border-border-default text-xs font-heading font-semibold text-text-secondary uppercase">
                <tr>
                  <th className="p-3.5 font-semibold">Search Name</th>
                  <th className="p-3.5 font-semibold">Target Parameters</th>
                  <th className="p-3.5 font-semibold text-right">Lead Target</th>
                  <th className="p-3.5 font-semibold">Schedule</th>
                  <th className="p-3.5 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle text-xs">
                {savedSearches.map((s, idx) => (
                  <tr key={idx} className="hover:bg-bg-canvas/40 transition">
                    <td className="p-3.5 font-heading font-semibold text-text-primary">{s.name}</td>
                    <td className="p-3.5 text-text-secondary">{s.parameters}</td>
                    <td className="p-3.5 text-right font-heading font-bold text-brand-primary tabular-nums">{s.matches}</td>
                    <td className="p-3.5 text-text-secondary font-heading">{s.lastRun}</td>
                    <td className="p-3.5 text-right space-x-2">
                      <Button variant="ghost" size="sm" className="text-xs px-2 h-7" onClick={() => handleLoadPreset(s.raw)}>
                        Load
                      </Button>
                      <Button variant="ghost" size="sm" className="text-xs text-status-danger px-2 h-7" onClick={() => handleDeleteSearch(s.id)}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
};

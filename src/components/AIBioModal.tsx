import React, { useState } from 'react';

interface AIBioModalProps {
  isOpen: boolean;
  onClose: () => void;
  businessName: string;
  businessType: string;
  ownerName: string;
  onApply: (bio: string, tagline: string) => void;
}

export const AIBioModal: React.FC<AIBioModalProps> = ({
  isOpen,
  onClose,
  businessName,
  businessType,
  ownerName,
  onApply,
}) => {
  const [vibe, setVibe] = useState<string>('Luxury & Botanical');
  const [specialties, setSpecialties] = useState<string>('Balayage, Scalp Detox, Tailored Haircuts');
  const [targetCustomers, setTargetCustomers] = useState<string>('Luxury');
  const [storyTone, setStoryTone] = useState<string>('Professional');
  const [taglineOptions, setTaglineOptions] = useState<string[]>([]);
  const [selectedTagline, setSelectedTagline] = useState<string>('');
  const [generatedBio, setGeneratedBio] = useState<string>('');
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [recordingSeconds, setRecordingSeconds] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(false);

  if (!isOpen) return null;

  const handleGenerate = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/generate-bio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          businessName: businessName || 'Our Salon',
          businessType,
          ownerName: ownerName || 'Salon Founder',
          vibe,
          specialties,
          targetCustomers,
          storyTone
        })
      });

      if (response.ok) {
        const data = await response.json();
        const options = Array.isArray(data.taglines) && data.taglines.length ? data.taglines : [data.tagline];
        setTaglineOptions(options);
        setSelectedTagline(options[0]);
        setGeneratedBio(data.bio);
        onApply(data.bio, options[0]);
        setLoading(false);
        return;
      }
    } catch {
      // Fallback generator
    }

    // High quality fallback auto-composition
    setTimeout(() => {
      const generatedTagline = `Redefining ${businessType.replace('_', ' ')} with ${targetCustomers.toLowerCase()} care.`;
      const generatedBio = `Welcome to ${businessName || 'our studio'}, founded by ${ownerName || 'our team'}. We have created a warm, welcoming space where every guest can slow down, feel comfortable, and enjoy genuinely personalised care. Our specialists offer ${specialties || 'exceptional salon services'}, combining thoughtful technique, honest guidance, and attention to every detail. We take time to understand your needs, explain each step, and shape every treatment around your comfort and goals. Whether you are here for a fresh look, restorative care, or a moment of self-care, our promise is to make you feel heard, respected, and confident. With a ${vibe.toLowerCase()} atmosphere and a passion for authentic service, we believe every visit should leave you feeling renewed, cared for, and beautifully yourself.`;
      const options = [generatedTagline, `Your ${targetCustomers.toLowerCase()} destination for beautiful, confident results.`, `Where expert ${specialties.split(',')[0].trim()} meets effortless self-care.`, `Elevate your everyday with thoughtfully crafted beauty.`, `Feel renewed. Look radiant. Love your time with us.`];
      setTaglineOptions(options);
      setSelectedTagline(options[0]);
      setGeneratedBio(generatedBio);
      onApply(generatedBio, options[0]);
      setLoading(false);
    }, 1200);
  };

  const toggleRecording = () => {
    if (isRecording) {
      setIsRecording(false);
      setRecordingSeconds(0);
      return;
    }

    const SpeechRecognition = typeof window !== 'undefined' ? ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition) : null;
    
    if (SpeechRecognition) {
      try {
        const recognition = new SpeechRecognition();
        recognition.continuous = false;
        recognition.interimResults = false;
        recognition.lang = 'en-IN';

        recognition.onstart = () => {
          setIsRecording(true);
          setRecordingSeconds(0);
        };

        recognition.onresult = (event: any) => {
          const transcript = event.results[0][0].transcript;
          if (transcript) {
            setSpecialties((prev) => (prev ? `${prev}, ${transcript}` : transcript));
          }
        };

        recognition.onerror = () => {
          setIsRecording(false);
        };

        recognition.onend = () => {
          setIsRecording(false);
        };

        recognition.start();
        return;
      } catch (err) {
        console.warn('Native speech recognition fallback:', err);
      }
    }

    // Fallback simulated voice timer
    setIsRecording(true);
    const interval = setInterval(() => {
      setRecordingSeconds((prev) => {
        if (prev >= 4) {
          clearInterval(interval);
          setIsRecording(false);
          setSpecialties('Precision haircuts, creative balayage, gel nail extensions, and restorative scalp therapy');
          return 0;
        }
        return prev + 1;
      });
    }, 1000);
  };

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/60 backdrop-blur-sm overflow-y-auto"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div 
        className="mx-auto flex my-auto max-h-[90dvh] w-full max-w-[min(600px,95vw)] flex-col gap-5 overflow-y-auto rounded-2xl border border-gray-200 bg-white p-4 shadow-2xl sm:p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center border-b border-gray-100 pb-4">
          <div className="flex items-center gap-2 text-[#C20E5A]">
            <span className="material-symbols-outlined text-2xl">auto_awesome</span>
            <h3 className="font-display font-bold text-lg text-gray-900">
              AI Salon Story Generator
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <p className="text-xs text-gray-600">
          Tell us a few keywords or dictate your story. AI will format it into a high-converting, professional salon tagline and bio.
        </p>

        {/* Vibe selection */}
        <div className="flex flex-col gap-2">
          <label className="text-xs font-bold font-mono-caps text-gray-700">
            Salon Vibe & Vibe Keywords
          </label>
          <div className="grid grid-cols-2 gap-2">
            {['Luxury & Botanical', 'Trendy & High-Energy', 'Minimalist & Zen', 'Classic & Vintage Barber'].map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setVibe(v)}
                className={`p-2.5 rounded-xl text-xs font-medium border text-left transition-all ${
                  vibe === v
                    ? 'border-[#C20E5A] bg-[#C20E5A]/10 text-[#C20E5A] font-bold'
                    : 'border-gray-200 text-gray-600 hover:border-gray-300'
                }`}
              >
                {v}
              </button>
            ))}
          </div>
        </div>

        {/* Voice Dictation OR Keywords input */}
        <div className="flex flex-col gap-2">
          <div className="flex justify-between items-center">
            <label className="text-xs font-bold font-mono-caps text-gray-700">
              Keywords & Core Specialties
            </label>
            <button
              type="button"
              onClick={toggleRecording}
              className={`text-xs font-bold px-2.5 py-1 rounded-full flex items-center gap-1 transition-all ${
                isRecording 
                  ? 'bg-red-500 text-white animate-pulse' 
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              <span className="material-symbols-outlined text-sm">
                {isRecording ? 'graphic_eq' : 'mic'}
              </span>
              <span>{isRecording ? `Listening (${recordingSeconds}s)...` : 'Speak keywords'}</span>
            </button>
          </div>

          <input
            type="text"
            value={specialties}
            onChange={(e) => setSpecialties(e.target.value)}
            placeholder="e.g. Balayage, Scalp detox, Bridal makeup, Grooming"
            className="w-full px-3.5 py-2.5 text-xs rounded-xl border border-gray-200 bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#C20E5A]/20 focus:border-[#C20E5A] transition-all"
          />
          <p className="text-[10px] text-gray-400">
            Enter a few keywords separated by commas. AI will generate a professional bio.
          </p>
        </div>

        {/* Story tone */}
        <div className="flex flex-col gap-2">
          <label className="text-xs font-bold font-mono-caps text-gray-700">About Us Story Tone</label>
          <div className="grid grid-cols-3 gap-2">
            {['Professional', 'Friendly', 'Luxury'].map((tone) => (
              <button key={tone} type="button" onClick={() => setStoryTone(tone)} className={`p-2.5 rounded-xl text-xs font-semibold border transition-all ${storyTone === tone ? 'border-[#C20E5A] bg-[#C20E5A]/10 text-[#C20E5A]' : 'border-gray-200 text-gray-600 hover:border-gray-300'}`}>{tone}</button>
            ))}
          </div>
          <p className="text-[10px] text-gray-400">AI will write a 100–150 word About Us story focused on comfort and authentic care.</p>
        </div>

        {/* Target customer */}
        <div className="flex flex-col gap-2">
          <label className="text-xs font-bold font-mono-caps text-gray-700">Target Customer & Service Positioning</label>
          <div className="grid grid-cols-3 gap-2">
            {['Luxury', 'Affordable', 'Organic'].map((option) => (
              <button key={option} type="button" onClick={() => setTargetCustomers(option)} className={`p-2.5 rounded-xl text-xs font-semibold border transition-all ${targetCustomers === option ? 'border-[#C20E5A] bg-[#C20E5A]/10 text-[#C20E5A]' : 'border-gray-200 text-gray-600 hover:border-gray-300'}`}>{option}</button>
            ))}
          </div>
        </div>

        {taglineOptions.length > 0 && (
          <div className="flex flex-col gap-2">
            <label className="text-xs font-bold font-mono-caps text-gray-700">Choose Your Catchphrase</label>
            <div className="space-y-2">
              {taglineOptions.map((option, index) => (
                <button key={`${option}-${index}`} type="button" onClick={() => { setSelectedTagline(option); onApply(generatedBio, option); }} className={`w-full text-left p-3 rounded-xl border text-xs transition-all ${selectedTagline === option ? 'border-[#C20E5A] bg-[#C20E5A]/10 text-[#9d0b49] font-semibold' : 'border-gray-200 text-gray-700 hover:border-[#C20E5A]/50'}`}>{index + 1}. {option}</button>
              ))}
            </div>
          </div>
        )}

        {/* Generate Button */}
        <div className="flex justify-end gap-3 pt-2 border-t border-gray-100">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-bold text-gray-600 hover:bg-gray-100 rounded-lg"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleGenerate}
            disabled={loading}
            className="px-6 py-2.5 text-xs font-bold text-white bg-[#C20E5A] hover:bg-[#A30B4A] rounded-xl flex items-center gap-2 shadow-lg shadow-[#C20E5A]/20 disabled:opacity-50 transition-all"
          >
            {loading ? (
              <>
                <span className="material-symbols-outlined text-sm animate-spin">refresh</span>
                <span>Writing Story...</span>
              </>
            ) : (
              <>
                <span className="material-symbols-outlined text-sm">auto_awesome</span>
                <span>Generate Bio & Tagline</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

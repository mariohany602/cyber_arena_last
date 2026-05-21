import type { Tool } from "../../data/tools";
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Play, Shield, Zap, Info } from 'lucide-react';
import { motion } from 'framer-motion';

interface ToolCardProps {
  tool: Tool;
}

export default function ToolCard({ tool }: ToolCardProps) {
  const [loading] = useState(false);
  const navigate = useNavigate();

  const handleAction = () => {
    if (tool.path) {
      navigate(tool.path);
    } else {
      console.warn(`No path defined for tool: ${tool.name}`);
    }
  };

  const isRedTeam = tool.team === 'Red';

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -6 }}
      transition={{ type: 'spring', stiffness: 300, damping: 24 }}
      className={`group relative overflow-hidden glass-panel p-6 lift-card
        ${isRedTeam ? 'hover:!shadow-glow-magenta hover:!border-neon-magenta/40' : ''}`}
    >
      {/* Top hairline */}
      <div className="absolute top-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />

      {/* Background accent blob */}
      <div
        className={`absolute -top-12 -right-12 w-40 h-40 rounded-full blur-3xl opacity-[0.06] group-hover:opacity-25 transition-opacity duration-500
          ${isRedTeam ? 'bg-neon-magenta' : 'bg-brand-primary'}`}
      />

      <div className="relative z-10 flex flex-col h-full">
        {/* Header */}
        <div className="flex items-start justify-between mb-5">
          <div className="flex items-center gap-3 min-w-0">
            <div
              className={`w-12 h-12 rounded-xl flex items-center justify-center border transition-all duration-300
                group-hover:scale-110 group-hover:rotate-[-4deg]
                ${isRedTeam
                  ? 'bg-neon-magenta/10 border-neon-magenta/30 text-neon-magenta'
                  : 'bg-brand-primary/10 border-brand-primary/30 text-brand-primary-bright'}`}
            >
              <Zap size={22} strokeWidth={2.4} />
            </div>
            <div className="min-w-0">
              <h3 className="text-lg font-black text-white tracking-tight leading-tight truncate">
                {tool.name}
              </h3>
              <p className="text-[10px] font-mono font-bold text-ui-subtle uppercase tracking-[0.2em] mt-1">
                {tool.category}
              </p>
            </div>
          </div>
          <span className={`chip ${isRedTeam ? 'chip-magenta' : 'chip-primary'} flex-shrink-0`}>
            {tool.team}
          </span>
        </div>

        {/* Description */}
        <p className="text-ui-muted mb-7 text-sm leading-relaxed line-clamp-2 min-h-[2.6rem]">
          {tool.description}
        </p>

        {/* Footer */}
        <div className="mt-auto space-y-4">
          <button
            onClick={handleAction}
            disabled={loading}
            className={`cyber-button w-full py-3.5 text-[11px] tracking-[0.3em]
              ${isRedTeam ? 'cyber-button-magenta' : 'cyber-button-primary'}`}
          >
            {loading ? (
              <div className="animate-spin rounded-full h-4 w-4 border-2 border-white/20 border-t-white" />
            ) : (
              <>
                <Play size={13} className="fill-current" />
                <span>DEPLOY MODULE</span>
              </>
            )}
          </button>

          <div className="flex items-center justify-between pt-3 border-t border-ui-border/20">
            <div className="flex items-center gap-1.5 text-ui-subtle">
              <Shield size={11} />
              <span className="text-[10px] font-black uppercase tracking-widest">
                Level: <span className="text-ui-muted">{tool.level}</span>
              </span>
            </div>
            <div className="flex items-center gap-1.5 text-ui-subtle">
              <Info size={11} />
              <span className="text-[10px] font-mono font-bold">#{tool.id}</span>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

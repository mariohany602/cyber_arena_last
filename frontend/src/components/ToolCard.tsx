import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Terminal } from "lucide-react";

type Props = {
  id: string;
  title: string;
  description: string;
  icon?: any; // Accepting icon prop even if not passed yet (optional)
};

export default function ToolCard({ id, title, description }: Props) {
  const navigate = useNavigate();

  return (
    <motion.article
      whileHover={{ y: -5, boxShadow: "0 0 30px rgba(0, 245, 255, 0.2)" }}
      className="group relative glass-panel p-6 rounded-2xl overflow-hidden transition-all hover:border-neon-cyan/50 flex flex-col h-full bg-black/40"
    >
      {/* Decorative Gradient Blob */}
      <div className="absolute -right-10 -top-10 w-32 h-32 bg-neon-cyan/5 rounded-full blur-3xl group-hover:bg-neon-cyan/10 transition-all duration-500" />

      <div className="relative z-10 flex-1">
        <div className="mb-4 w-12 h-12 rounded-lg bg-neon-cyan/5 flex items-center justify-center border border-white/10 group-hover:border-neon-cyan/50 group-hover:text-neon-cyan transition-colors">
          <Terminal size={24} className="text-slate-400 group-hover:text-neon-cyan" />
        </div>

        <h3 className="text-xl font-bold text-white mb-2 group-hover:text-neon-cyan transition-colors tracking-tight">{title}</h3>
        <p className="text-sm text-slate-400 leading-relaxed font-medium">{description}</p>
      </div>

      <div className="mt-6 relative z-10">
        <button
          onClick={() => navigate(id === "nmap-scanner" ? "/tools/nmap-scanner" : `/tools/${id}`)}
          className="w-full py-3 px-4 bg-neon-cyan/10 hover:bg-neon-cyan text-neon-cyan hover:text-black rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-2 border border-neon-cyan/20 hover:border-neon-cyan"
        >
          <span>Launch Module</span>
          <ArrowRight size={16} />
        </button>
      </div>
    </motion.article>
  );
}
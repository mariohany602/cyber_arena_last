import { motion } from "framer-motion";
import type { LucideIcon } from "lucide-react";

interface CircularGaugeProps {
    value: number;
    maxValue: number;
    label: string;
    icon: LucideIcon;
    color: 'cyan' | 'magenta' | 'yellow' | 'green' | 'orange' | 'blue';
    unit?: string;
}

const colorConfig = {
    cyan: {
        stroke: '#00f5ff',
        glow: 'drop-shadow(0 0 8px rgba(0, 245, 255, 0.6))',
        bg: 'bg-neon-cyan/10',
        text: 'text-neon-cyan',
        shadow: 'shadow-glow-cyan'
    },
    magenta: {
        stroke: '#ff00ff',
        glow: 'drop-shadow(0 0 8px rgba(255, 0, 255, 0.6))',
        bg: 'bg-neon-magenta/10',
        text: 'text-neon-magenta',
        shadow: 'shadow-glow-magenta'
    },
    yellow: {
        stroke: '#ffff00',
        glow: 'drop-shadow(0 0 8px rgba(255, 255, 0, 0.6))',
        bg: 'bg-neon-yellow/10',
        text: 'text-neon-yellow',
        shadow: 'shadow-glow-yellow'
    },
    green: {
        stroke: '#00ff00',
        glow: 'drop-shadow(0 0 8px rgba(0, 255, 0, 0.6))',
        bg: 'bg-neon-green/10',
        text: 'text-neon-green',
        shadow: 'shadow-glow-green'
    },
    orange: {
        stroke: '#ff6600',
        glow: 'drop-shadow(0 0 8px rgba(255, 102, 0, 0.6))',
        bg: 'bg-neon-orange/10',
        text: 'text-neon-orange',
        shadow: 'shadow-glow-orange'
    },
    blue: {
        stroke: '#0099ff',
        glow: 'drop-shadow(0 0 8px rgba(0, 153, 255, 0.6))',
        bg: 'bg-neon-blue/10',
        text: 'text-neon-blue',
        shadow: 'shadow-glow-blue'
    }
};

export default function CircularGauge({ value, maxValue, label, icon: Icon, color, unit = '' }: CircularGaugeProps) {
    const percentage = (value / maxValue) * 100;
    const circumference = 2 * Math.PI * 45; // radius = 45
    const strokeDashoffset = circumference - (percentage / 100) * circumference;
    const config = colorConfig[color];

    return (
        <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5 }}
            className={`glass-panel rounded-2xl p-6 ${config.shadow} transition-all hover:scale-105`}
        >
            <div className="flex flex-col items-center">
                {/* Circular Progress */}
                <div className="relative w-32 h-32 mb-4">
                    <svg className="w-full h-full transform -rotate-90">
                        {/* Background circle */}
                        <circle
                            cx="64"
                            cy="64"
                            r="45"
                            stroke="rgba(255, 255, 255, 0.05)"
                            strokeWidth="8"
                            fill="none"
                        />
                        {/* Progress circle */}
                        <motion.circle
                            cx="64"
                            cy="64"
                            r="45"
                            stroke={config.stroke}
                            strokeWidth="8"
                            fill="none"
                            strokeLinecap="round"
                            strokeDasharray={circumference}
                            initial={{ strokeDashoffset: circumference }}
                            animate={{ strokeDashoffset }}
                            transition={{ duration: 2, ease: "easeOut" }}
                            style={{ filter: config.glow }}
                        />
                    </svg>

                    {/* Center content */}
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                        <div className={`p-2 ${config.bg} rounded-lg mb-1`}>
                            <Icon size={24} className={config.text} />
                        </div>
                        <span className={`text-2xl font-bold ${config.text}`}>
                            {value}{unit}
                        </span>
                    </div>
                </div>

                {/* Label */}
                <p className="text-sm font-medium text-slate-400 text-center">{label}</p>
                <div className="mt-2 text-xs text-slate-500">
                    {percentage.toFixed(0)}% of {maxValue}
                </div>
            </div>
        </motion.div>
    );
}

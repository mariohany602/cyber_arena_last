import ToolCard from "./ToolCard";
import { tools } from "./data/tools"; // المسار الصحيح بناءً على مكان الفولدر في صورتك

export default function ToolsGrid() {
  return (
    <section id="tools" className="mt-6">
      <h2 className="text-2xl font-semibold mb-4 text-white">Security Tools</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {tools.map((t) => (
          <ToolCard 
            key={t.id} 
            id={t.id} 
            title={t.name} 
            description={t.description} 
          />
        ))}
      </div>
    </section>
  );
}
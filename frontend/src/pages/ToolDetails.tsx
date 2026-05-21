import { useParams } from "react-router-dom";
import { tools } from "../data/tools";
import Scanner from "./Scanner"; // تأكدي إن Scanner.tsx موجود في نفس الفولدر

export default function ToolDetails() {
    const { id } = useParams();
    const tool = tools.find((t) => t.id === id);

    // لو المستخدم فتح أداة الـ Nmap، اعرضي صفحة الـ Scanner فوراً
    if (id === "nmap-scanner") {
        return <Scanner />;
    }

    if (!tool) {
        return <div className="p-20 text-white">Tool not found</div>;
    }

    return (
        <div className="p-20 text-white">
            <h1 className="text-3xl font-bold">{tool.name}</h1>
            <p className="mt-4 text-slate-400">{tool.description}</p>
        </div>
    );
}
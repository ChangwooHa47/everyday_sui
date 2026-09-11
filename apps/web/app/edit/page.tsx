import { redirect } from "next/navigation";

// 편집 기능은 캐릭터 페이지(/character) 설정 탭이 흡수했다.
export default function EditRedirect() {
  redirect("/character");
}

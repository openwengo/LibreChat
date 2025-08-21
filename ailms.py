import httpx
import json
import urllib.parse
from datetime import datetime, timedelta
from mcp.server.fastmcp import FastMCP
from typing import Optional, Literal, Annotated
from pydantic import BaseModel, Field, AfterValidator

# Custom types with metadata (used mostly for documentation purposes)
HTMLStr = Annotated[str, Field(description="HTML content string like <p>...</p>")]
CpqHTMLStr = Annotated[
    str,
    Field(
        description="""HTML content with answer spans inside
<code>
<span style="background-color: rgba(var(--background-primary), 0.3)">...</span>
</code>."""
    ),
]


def validate_uuid_format(v: str) -> str:
    try:
        UUID(v)
        return v
    except ValueError:
        raise ValueError("Invalid UUID format.")


ValidatedUUIDstr = Annotated[str, AfterValidator(validate_uuid_format), Field(description="Validated UUID string")]


class MCQOption(BaseModel):
    text: str
    is_correct: bool = False  # Default to False, can be overridden


# Base AnswerItem model
class AnswerItem(BaseModel):
    mark: int
    answer: str


class QuestionItem(BaseModel):
    type: Literal["mcq", "cloze", "structured"]  # Not used in API but useful for documentation
    id: ValidatedUUIDstr
    question: str


# Extended model with additional fields
class DetailedAnswer(QuestionItem, AnswerItem):
    pass


class QuestionItemWithMark(QuestionItem):
    mark: int


class MCQItem(QuestionItemWithMark):
    pass


class ClozeItem(QuestionItemWithMark):
    name: str
    student_view: str


class StructuredItem(QuestionItemWithMark):
    name: str
    content: str


def validate_duration_format(v: str) -> str:
    try:
        test_duration = int(v)
        duration_hours, duration_minutes = divmod(test_duration, 60)
        _ = timedelta(hours=duration_hours, minutes=duration_minutes)
    except ValueError:
        raise ValueError("Invalid duration format. Must be an integer string representing minutes.")
    return v


class PaperItem(BaseModel):
    title: str
    duration: Annotated[str, AfterValidator(validate_duration_format), Field(
        description="Duration in minutes as a string, e.g., '120' for 2 hours."
    )]
    access: Literal["Private", "Public", "Organization"] = "Private"
    language: Literal["en", "ms"]


class PaperData(PaperItem):
    pass_point: Annotated[int, Field(gt=0)]  # ✅ Must be > 0
    mcq_list: list[MCQItem] = []
    cloze_list: list[ClozeItem] = []
    structured_list: list[StructuredItem] = []


class QuizMCQItem(QuestionItem):
    timer: int


class QuizData(PaperItem):
    course: ValidatedUUIDstr
    module: ValidatedUUIDstr
    section: ValidatedUUIDstr
    guest_attempt: bool
    value: Annotated[Literal["", "Summary", "Detail"], Field(
        description="""
        If the teacher want to let guest attempt the quiz,
        then they will choose whether to let the guest view the detail or just a short summary of the quiz report.
        """
    )]
    mcq_list: list[QuizMCQItem]


# Initialize FastMCP server
mcp = FastMCP("login")

# API constants
CORE_URL = "https://ailms-core.v-aim.com/api/v1/"
LOGIN_API_URL = f"{CORE_URL}login/"
CREATE_MCQ_URL = f"{CORE_URL}question/multiple-choice/"
CREATE_CPQ_URL = f"{CORE_URL}question/cloze_passage/"
CREATE_SQ_URL = f"{CORE_URL}question/structured/"
CREATE_PAPER_COMPLETED_URL = f"{CORE_URL}paper/paper-completed/"
GET_QUESTION_LIST_BY_PAPER_URL = f"{CORE_URL}paper/edit/"
GET_QUESTION_LIST_BY_TAGS_URL = f"{CORE_URL}question/list/"
MARK_PAPER_URL = f"{CORE_URL}paper/mark-paper/"
SET_INACTIVE_URL = f"{CORE_URL}paper/set-inactive/"
GET_QUESTION_TAGS_URL = f"{CORE_URL}question/tags/"
CREATE_PAPER_URL = f"{CORE_URL}paper/publish/"
CREATE_QUIZ_URL = f"{CORE_URL}quiz/publish/"
GET_COURSE_LIST_URL = f"{CORE_URL}course/?filter_by=Public,Private,Organization&"
GET_MODULE_LIST_URL = f"{CORE_URL}module/"
GET_SECTION_LIST_URL = f"{CORE_URL}section/"


def auth_headers(token: str) -> dict:
    """Generate authorization headers."""
    return {"Authorization": f"Bearer {token}"}


async def perform_request(
    method: str, url: str, headers: dict, json: Optional[dict] = None, data: Optional[dict] = None,
    timeout: float = 10.0
) -> str:
    """Generic request handler with common error handling."""
    async with httpx.AsyncClient() as client:
        try:
            response = await client.request(method, url, headers=headers, json=json, data=data, timeout=timeout)
            response.raise_for_status()
            return response.text
        except httpx.HTTPStatusError as e:
            return f"HTTP error: {e.response.status_code} - {e.response.text}"
        except httpx.TimeoutException:
            return "Request timed out. Please try again later."
        except Exception as e:
            return f"Request error: {str(e)}"


@mcp.tool()
async def get_course_list(token: str) -> str:
    """Get the list of courses."""
    return await perform_request("GET", GET_COURSE_LIST_URL, headers=auth_headers(token))


@mcp.tool()
async def get_module_list(token: str, course_id: ValidatedUUIDstr) -> str:
    """Get the list of modules for a given course.
    Args:
        token: Bearer token from login
        course_id: The ID of the course to get modules for. Get this ID from `get_course_list` tool.
    """
    url = f"{GET_MODULE_LIST_URL}{course_id}/"
    return await perform_request("GET", url, headers=auth_headers(token))


@mcp.tool()
async def get_section_list(token: str, module_id: ValidatedUUIDstr) -> str:
    """Get the list of sections for a given module.
    Args:
        token: Bearer token from login
        module_id: The ID of the module to get sections for. Get this ID from `get_module_list` tool.
    """
    url = f"{GET_SECTION_LIST_URL}{module_id}/"
    return await perform_request("GET", url, headers=auth_headers(token))


@mcp.tool()
async def create_quiz(token: str, quiz_data: QuizData) -> str:
    """
    Create a quiz (MCQ only).

    Args:
        token: Bearer token from login
        quiz_data:
            - Validated QuizData structure
            - Contains course, module, section, and quiz details.
            - Get course, module, and section IDs from `get_course_list`, `get_module_list`,
            and `get_section_list` tools.
    """
    return await perform_request("POST", CREATE_QUIZ_URL, headers=auth_headers(token), json=quiz_data.model_dump())


@mcp.tool()
async def create_paper(token: str, paper_data: PaperData) -> str:
    """
    Create a paper with mixed question types (MCQ, CPQ, Structured).

    Args:
        token: Bearer token from login
        paper_data:
            - Pydantic model with validated structure
            - Get questions details from  `get_question_list_by_tags` tool.
    """
    return await perform_request("POST", CREATE_PAPER_URL, headers=auth_headers(token), json=paper_data.model_dump())


@mcp.tool()
async def mark_paper(token: str, paper_completed_id: str) -> str:
    """Mark a paper using the given access token.

        Args:
            token: Bearer token from login
            paper_completed_id:
                - The ID of the completed paper to be marked.
                - Get this ID from `create_paper_completed` tool.
    """
    url = f"{MARK_PAPER_URL}{paper_completed_id}/"
    return await perform_request("POST", url, headers=auth_headers(token), timeout=60.0)


@mcp.tool()
async def get_question_tags(token: str, type: Literal["MCQ", "CPQ", "SQ"]) -> str:
    """Get the list of tags for questions of a specific type.
        Args:
            token: Bearer token from login
            type: Type of question (MCQ, CPQ, SQ)
    """
    url = f"{GET_QUESTION_TAGS_URL}?question_type={type}"
    return await perform_request("GET", url, headers=auth_headers(token))


@mcp.tool()
async def get_question_list_by_tags(token: str, type: Literal["MCQ", "CPQ", "SQ"], tags: list[str]) -> str:
    """Get the list of questions filtered by type and tags.
        Args:
            token: Bearer token from login
            type: Type of question (MCQ, CPQ, SQ)
            tags: List of tags to filter questions. Get the tags from `get_question_tags` tool.
    """
    url = f"{GET_QUESTION_LIST_BY_TAGS_URL}?questionType={type}&tags={urllib.parse.quote(','.join(tags))}"
    return await perform_request("GET", url, headers=auth_headers(token))


@mcp.tool()
async def get_question_list_by_paper(token: str, paper_id: str) -> str:
    """Get the list of questions for a given paper ID."""
    url = f"{GET_QUESTION_LIST_BY_PAPER_URL}{paper_id}/"
    return await perform_request("GET", url, headers=auth_headers(token))


@mcp.tool()
async def login(username: str, password: str) -> str:
    """Login to AILMS API and return token or error message.

    Args:
        username: The username to login with.
        password: The password for the account.
    """
    headers = {"Content-Type": "application/json"}
    payload = {"username": username, "password": password}
    return await perform_request("POST", LOGIN_API_URL, headers=headers, json=payload)


@mcp.tool()
async def create_mcq(
    token: str,
    question_text: str,
    options: list[MCQOption],
    mark: int = 1,
    tags: list[str] = [],
    language: str = "en",
    access: str = "private",
) -> str:
    """
    Create a multiple choice question and its answers using the given access token.

    Args:
        token: Bearer token from login
        question_text: The question text
        options: A list of MCQOption objects representing the choices
        mark: The mark assigned to the question
        tags: List of tags for categorization
        language: Language code
        access: Access level (e.g., 'private', 'public')
    """
    headers = {"Authorization": f"Bearer {token}"}

    choices_payload = [
        {
            "choiceText": opt.text,
            "answer": opt.is_correct,
            "choiceImage": "",
            "choiceImageId": "",
        }
        for opt in options
    ]

    question_payload = [
        {
            "questionText": question_text,
            "choices": choices_payload,
            "mark": mark,
            "tags": tags,
            "questionImageId": "",
            "questionVideoId": "",
        }
    ]

    form_data = {
        "questions": json.dumps(question_payload),
        "language": language,
        "tags": tags,
        "access": access,
    }
    return await perform_request("POST", CREATE_MCQ_URL, headers=headers, data=form_data)


@mcp.tool()
async def create_cpq(
    token: str,
    title: str,
    value: CpqHTMLStr,
    mark: int = 1,
    tags: list[str] = [],
    language: str = "en",
    access: str = "Private",
) -> str:
    """Create a cloze passage question and its answers using the given access token.

        Args:
            token: Bearer token from login
            title: Title of the question
            mark: Marks for the question
            tags: List of tags
            language: Language of the question
            access: Access level (e.g., 'Private', 'Public')
    """
    headers = {"Authorization": f"Bearer {token}"}

    question_payload = {
        "title": title,
        "value": value,
        "access": access,
        "language": language,
        "mark": str(mark),
        "tags": tags,
    }

    form_data = {
        "question": json.dumps(question_payload),
    }
    return await perform_request("POST", CREATE_CPQ_URL, headers=headers, data=form_data)


@mcp.tool()
async def create_sq(
    token: str,
    title: str,
    question: str,
    answer: list[AnswerItem],
    canvas_mark: int = 0,
    canvas_data: list = [],
    task_achievement: int = 20,
    coherence: int = 20,
    grammartical_range: int = 20,
    lexical_resource: int = 20,
    cdex: int = 20,
    tags: list[str] = [],
    language: str = "en",
    access: str = "Private",
    answer_tone: str = "",
    question_image_id: str = "",
) -> str:
    """
    Create a structured question and its answers using the given access token.
    """
    headers = {"Authorization": f"Bearer {token}"}

    question_payload = {
        "title": title,
        "question": question,
        "answer": json.dumps([answer_item.model_dump() for answer_item in answer]),
        "canvas_mark": canvas_mark,
        "canvasData": canvas_data,
        "task_achievement": task_achievement,
        "coherence": coherence,
        "grammartical_range": grammartical_range,
        "lexical_resource": lexical_resource,
        "cdex": cdex,
        "tags": tags,
        "language": language,
        "access": access,
        "answer_tone": answer_tone,
        "question_image_id": question_image_id,
    }
    return await perform_request("POST", CREATE_SQ_URL, headers=headers, data=question_payload)


@mcp.tool()
async def create_paper_completed(
    token: str,
    paper: str,
    student_username: str,
    submission_date: datetime,
    end_date: datetime,
    end_time: datetime,
    total_mark: int,
    answer: list[DetailedAnswer],
) -> str:
    """Create a paper completed record using the given access token.

        Args:
            token: Bearer token from login
            paper: The ID of the paper being completed
            student_username: The username of the student completing the paper
            submission_date: The date of submission
            end_date: The end date of the paper
            end_time: The end time of the paper
            total_mark: The total mark for the paper
            answer:
                - List of DetailedAnswer objects containing answers to the paper.
                - Get the detail from `get_question_list_by_paper` tool.
    """
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

    payload = {
        "paper": paper,
        "student_username": student_username,
        "submission_date": submission_date.isoformat(),
        "end_date": end_date.isoformat(),
        "end_time": end_time.isoformat(),
        "total_mark": total_mark,
        "answer": [ans.model_dump(mode="json") for ans in answer],
    }
    return await perform_request("POST", CREATE_PAPER_COMPLETED_URL, headers=headers, json=payload)

def main() -> None:
    """Entry point for running AILMS MCP server."""
    mcp.run(transport="stdio")


if __name__ == "__main__":
    main()

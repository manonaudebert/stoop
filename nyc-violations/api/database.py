import os
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import NullPool
from sqlalchemy.exc import InvalidRequestError
from dotenv import load_dotenv

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), '..', '.env'))


def _build_url() -> str:
    url = os.environ["DATABASE_URL"]
    base = url.split('?')[0]
    return base.replace("postgresql://", "postgresql+asyncpg://", 1)


engine = create_async_engine(
    _build_url(),
    poolclass=NullPool,
    connect_args={"ssl": "require", "statement_cache_size": 0},
)

AsyncSessionLocal = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


async def get_db():
    async with AsyncSessionLocal() as session:
        try:
            yield session
        except InvalidRequestError as e:
            if "InvalidCachedStatementError" in str(e):
                # Schema changed under a cached plan — session already invalidated,
                # close it so the next request gets a clean connection.
                await session.close()
            raise
